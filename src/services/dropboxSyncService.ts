import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { SyncRunRecord } from '@/types/database';
import type {
  PlannedAddition,
  SyncPlan,
} from '../../supabase/functions/_shared/syncPlan';

/**
 * Client for the dropbox-sync edge function. Thin on purpose: the function does
 * the authorization, the listing and the diff; this only names the calls and
 * turns supabase-js's generic "non-2xx" into the function's actual message.
 */

export type StoredSyncPlan = Omit<SyncPlan, 'additions'> & {
  additions: Array<PlannedAddition & { photoId: string }>;
};

export interface SyncValidation {
  ok: true;
  listing: {
    complete: boolean;
    reason: string | null;
    fileCount: number;
    imageCount: number;
    totalBytes: number;
    over20MB: number;
    hasIds: boolean;
    hasRevs: boolean;
    hasHashes: boolean;
    sample: string[];
  };
  storage: { usedBytes: number; quotaBytes: number };
  importState: string;
  lastSyncedAt: string | null;
  activeRunId: string | null;
}

export interface SyncValidationFailure {
  ok: false;
  error: 'revoked_link';
  message: string;
  importState: string;
  activeRunId: string | null;
}

export interface SyncPlanResponse {
  runId: string;
  plan: StoredSyncPlan;
  storage: { usedBytes: number; projectedBytes: number; quotaBytes: number; refusedForQuota: boolean };
  coversAffected: Array<{ level: 'album' | 'event' | 'profile'; name: string }>;
  expiresAt: string;
}

export interface SyncStatusResponse {
  active: SyncRunRecord | null;
  latest: SyncRunRecord | null;
  importState: string;
  lastSyncedAt: string | null;
}

export class DropboxSyncError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly runId?: string | null) {
    super(message);
    this.name = 'DropboxSyncError';
  }
}

async function invokeSync<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('dropbox-sync', { body });

  if (error) {
    let message = error.message;
    let status = 0;
    let code: string | undefined;
    let runId: string | null | undefined;
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      status = response.status;
      try {
        const parsed = await response.json();
        if (typeof parsed?.message === 'string') message = parsed.message;
        else if (typeof parsed?.error === 'string') message = parsed.error;
        if (typeof parsed?.error === 'string') code = parsed.error;
        runId = parsed?.runId ?? undefined;
      } catch {
        message = `HTTP ${status}`;
      }
    }
    throw new DropboxSyncError(message, status, code, runId);
  }

  return data as T;
}

export function validateDropboxSync(albumId: string) {
  return invokeSync<SyncValidation | SyncValidationFailure>({ action: 'validate', albumId });
}

export function planDropboxSync(albumId: string) {
  return invokeSync<SyncPlanResponse>({ action: 'plan', albumId });
}

export function dropboxSyncStatus(albumId: string) {
  return invokeSync<SyncStatusResponse>({ action: 'status', albumId });
}

export function cancelDropboxSync(runId: string) {
  return invokeSync<{ runId: string; status: string }>({ action: 'cancel', runId });
}

export interface SyncApplyResponse {
  runId: string;
  status: 'applying' | 'verifying' | 'imported' | 'failed' | 'cancelled' | 'planned';
  cursor: number;
  total: number;
  applied: SyncRunRecord['applied'];
  errors: SyncRunRecord['errors'];
  error?: string;
  unresolvedCovers?: string[];
}

/**
 * Executes one chunk of a planned run. The server does at most ~20 items or
 * 80 seconds per call and returns its cursor; the caller loops while `status`
 * is 'applying'. Every chunk commits, so an interrupted loop resumes from
 * wherever it stopped.
 */
export function applyDropboxSync(runId: string, confirmation?: string) {
  return invokeSync<SyncApplyResponse>({ action: 'apply', runId, confirmation });
}
