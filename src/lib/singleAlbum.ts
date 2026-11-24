/**
 * The event's only album, when it has exactly one: clicking such an event
 * goes straight to that album instead of an event page with a single tile.
 *
 * Counts the albums this viewer can see (what the event page would show):
 * an unlisted album a visitor cannot see does not count, and an event with
 * a listed and an unlisted album opens the listed one. A locked album still
 * counts; its own page asks for the PIN.
 */
export function singleAlbumOf<T extends { event_id: string; slug?: string | null }>(
  eventId: string,
  albums: readonly T[],
): T | null {
  let only: T | null = null;
  for (const album of albums) {
    if (album.event_id !== eventId) continue;
    if (only) return null;
    only = album;
  }
  return only;
}
