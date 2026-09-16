/**
 * Shared Dropbox client for edge functions.
 *
 * Two structural bugs motivated this module:
 *
 * 1. Both callers fetched the OAuth access token at MODULE scope, so a warm
 *    isolate reused the same token forever. Dropbox short-lived tokens expire in
 *    ~4h, after which every request 401s with no recovery path. A throw at module
 *    scope was worse still: the function failed to boot at all, surfacing as an
 *    opaque 503 rather than a JSON error.
 *
 * 2. Failures were swallowed. Per-file metadata used `res.ok ? res.json() : null`
 *    followed by `.filter(Boolean)`, and the pagination loop never checked `.ok`,
 *    so a non-2xx `continue` left `entries` undefined and `has_more` undefined -
 *    the loop exited cleanly with a partial listing and no error. Files silently
 *    VANISHED. That is survivable while merely displaying a folder. It is
 *    catastrophic once a sync diffs the listing against stored rows, because a
 *    short listing reads exactly like "the user deleted these photos".
 *
 * So: the token is cached against its own expiry and refreshed on demand, and
 * every helper either returns complete data or throws. Nothing here ever returns
 * a partial result, and nothing here ever logs a secret.
 */

const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const RPC_ENDPOINT = "https://api.dropboxapi.com/2";
const CONTENT_ENDPOINT = "https://content.dropboxapi.com/2";

/** Refresh this far ahead of the real expiry, to cover clock skew and flight time. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Dropbox tokens are ~4h; used only when the response omits `expires_in`. */
const TOKEN_DEFAULT_TTL_SECONDS = 14_400;

const MAX_ATTEMPTS = 5;
/** Guards against a server-side cursor loop; ~500 entries/page, so this is 250k files. */
const MAX_PAGES = 500;

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export class DropboxError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Dropbox API error ${status}: ${body.slice(0, 500)}`);
    this.name = "DropboxError";
  }
}

export interface DropboxEntry {
  ".tag": string;
  name: string;
  id?: string;
  path_lower?: string;
  rev?: string;
  size?: number;
  content_hash?: string;
  client_modified?: string;
  server_modified?: string;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, so concurrent retries do not resynchronise. */
function backoffMs(attempt: number): number {
  return 2 ** attempt * 500 + Math.random() * 250;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Exported for tests and for the 401 retry path; clears the memoised token. */
export function invalidateDropboxToken(): void {
  cachedToken = null;
}

export async function getDropboxToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS) {
    return cachedToken.token;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: requireEnv("DROPBOX_REFRESH_TOKEN"),
      client_id: requireEnv("DROPBOX_APP_KEY"),
      client_secret: requireEnv("DROPBOX_SECRET_KEY"),
    }),
  });

  if (!response.ok) {
    // The error body echoes the client_id back, so it is deliberately not logged
    // and not attached to the thrown error.
    await response.body?.cancel();
    throw new DropboxError(response.status, "token refresh failed");
  }

  const result = await response.json();
  if (!result.access_token) {
    throw new Error("Dropbox token response contained no access_token");
  }

  cachedToken = {
    token: result.access_token,
    expiresAt: Date.now() + (result.expires_in ?? TOKEN_DEFAULT_TTL_SECONDS) * 1000,
  };
  return cachedToken.token;
}

/**
 * Authenticated fetch with token refresh and retry.
 *
 * Retries a 401 once with a freshly minted token (covers the expired-token case),
 * and backs off on 429 and 5xx, honouring `Retry-After` when present. Anything
 * else - and anything still failing after MAX_ATTEMPTS - throws. It never returns
 * a non-ok response, so callers cannot accidentally treat a failure as empty data.
 */
export async function dropboxFetch(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await getDropboxToken();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });

    if (res.ok) return res;

    const isLastAttempt = attempt >= MAX_ATTEMPTS - 1;

    if (res.status === 401 && !isLastAttempt) {
      await res.body?.cancel();
      invalidateDropboxToken();
      continue;
    }

    if ((res.status === 429 || res.status >= 500) && !isLastAttempt) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
      await res.body?.cancel();
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
      continue;
    }

    throw new DropboxError(res.status, await res.text());
  }
}

export async function dropboxRpc<T>(path: string, body: unknown): Promise<T> {
  const res = await dropboxFetch(`${RPC_ENDPOINT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/**
 * `Dropbox-API-Arg` travels in an HTTP header, which must be ASCII. Filenames
 * with accents or CJK characters break the request otherwise, so escape
 * everything above U+007F into JSON \uXXXX form.
 */
function toApiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function dedupeEntries(entries: DropboxEntry[]): DropboxEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.id || entry.path_lower || entry.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isImageEntry(entry: DropboxEntry): boolean {
  return (
    entry[".tag"] === "file" &&
    IMAGE_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
  );
}

/**
 * Lists every entry in a shared folder, following pagination to the end.
 *
 * Returns a COMPLETE listing or throws - there is no partial success. Callers
 * that diff this against stored rows depend on that guarantee absolutely.
 */
export async function listSharedFolder(folderUrl: string): Promise<DropboxEntry[]> {
  type Page = { entries?: DropboxEntry[]; cursor?: string; has_more?: boolean };

  let page = await dropboxRpc<Page>("/files/list_folder", {
    path: "",
    shared_link: { url: folderUrl },
  });

  const entries: DropboxEntry[] = [...(page.entries ?? [])];

  for (let pageCount = 1; page.has_more; pageCount++) {
    if (pageCount > MAX_PAGES) {
      throw new Error(`list_folder exceeded ${MAX_PAGES} pages; refusing to continue`);
    }
    if (!page.cursor) {
      throw new Error("list_folder reported has_more but returned no cursor");
    }
    page = await dropboxRpc<Page>("/files/list_folder/continue", { cursor: page.cursor });
    entries.push(...(page.entries ?? []));
  }

  return dedupeEntries(entries);
}

export async function getSharedLinkMetadata(
  folderUrl: string,
  fileName: string,
): Promise<DropboxEntry & { url: string }> {
  return await dropboxRpc("/sharing/get_shared_link_metadata", {
    url: folderUrl,
    path: `/${fileName}`,
  });
}

/** Streams one file out of a shared folder. The response body is not buffered here. */
export async function downloadSharedFile(
  folderUrl: string,
  fileName: string,
): Promise<Response> {
  return await dropboxFetch(`${CONTENT_ENDPOINT}/sharing/get_shared_link_file`, {
    method: "POST",
    headers: {
      "Dropbox-API-Arg": toApiArg({ url: folderUrl, path: `/${fileName}` }),
    },
  });
}
