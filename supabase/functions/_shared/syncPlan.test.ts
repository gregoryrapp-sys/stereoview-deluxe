import { describe, expect, it } from 'vitest';
import {
  applyPlanToRows,
  computeSyncPlan,
  DEFAULT_SYNC_OPTIONS,
  type DbPhotoRow,
  type DropboxFileMeta,
  type Listing,
} from './syncPlan';

function file(id: string, name: string, rev = 'r1', size = 1_000_000): DropboxFileMeta {
  return { id, name, rev, size };
}

function row(id: string, fileId: string | null, name: string | null, rev = 'r1', deleted: string | null = null): DbPhotoRow {
  return { id, dropbox_file_id: fileId, dropbox_name: name, dropbox_rev: rev, dropbox_size: 1_000_000, deleted_at: deleted };
}

const complete = <T,>(items: T[]): Listing<T> => ({ complete: true, items });
const incomplete = <T,>(items: T[], reason = 'rate limited'): Listing<T> => ({ complete: false, items, reason });

function liveSynced(n: number): DbPhotoRow[] {
  return Array.from({ length: n }, (_, i) => row(`p${i}`, `f${i}`, `IMG_${String(i).padStart(3, '0')}.jpg`));
}

function listingOf(rows: DbPhotoRow[]): DropboxFileMeta[] {
  return rows.map((r) => file(r.dropbox_file_id as string, r.dropbox_name as string, r.dropbox_rev as string));
}

describe('computeSyncPlan - refusals', () => {
  it('1. empty complete listing against a synced album refuses everything', () => {
    const plan = computeSyncPlan(complete(liveSynced(3)), complete([]));
    expect(plan.refusal?.code).toBe('empty_listing');
    expect(plan.deletions).toEqual([]);
    expect(plan.additions).toEqual([]);
    expect(plan.requiresTypedConfirmation).toBe(false);
  });

  it('empty listing against an album with only manual uploads is just a no-op', () => {
    const plan = computeSyncPlan(complete([row('m1', null, null)]), complete([]));
    expect(plan.refusal).toBeUndefined();
    expect(plan.deletions).toEqual([]);
  });

  it('2. incomplete Dropbox listing yields zero deletions but still adds', () => {
    const db = liveSynced(4);
    const plan = computeSyncPlan(complete(db), incomplete([file('new', 'new.jpg')]));
    expect(plan.refusal?.code).toBe('incomplete_dropbox_listing');
    expect(plan.deletions).toEqual([]);
    expect(plan.additions.map((a) => a.file.id)).toEqual(['new']);
  });

  it('3. incomplete DB listing (max_rows) yields zero deletions', () => {
    const db = liveSynced(4);
    const plan = computeSyncPlan(incomplete(db, 'count mismatch'), complete(listingOf(db).slice(0, 1)));
    expect(plan.refusal?.code).toBe('incomplete_db_listing');
    expect(plan.deletions).toEqual([]);
  });
});

describe('computeSyncPlan - matching', () => {
  it('4. same id, different name, same rev is a rename, not delete+add', () => {
    const db = [row('p1', 'f1', 'old.jpg')];
    const plan = computeSyncPlan(complete(db), complete([file('f1', 'new.jpg')]));
    expect(plan.renames).toEqual([{ photoId: 'p1', from: 'old.jpg', file: file('f1', 'new.jpg') }]);
    expect(plan.additions).toEqual([]);
    expect(plan.deletions).toEqual([]);
    expect(plan.bytesToDownload).toBe(0);
  });

  it('13. case-only rename is a rename', () => {
    const plan = computeSyncPlan(complete([row('p1', 'f1', 'photo.JPG')]), complete([file('f1', 'photo.jpg')]));
    expect(plan.renames).toHaveLength(1);
    expect(plan.deletions).toEqual([]);
  });

  it('5. same id, different rev is an update, never a deletion', () => {
    const plan = computeSyncPlan(complete([row('p1', 'f1', 'a.jpg', 'r1')]), complete([file('f1', 'a.jpg', 'r2', 2_000_000)]));
    expect(plan.updates).toEqual([{ photoId: 'p1', file: file('f1', 'a.jpg', 'r2', 2_000_000), thumbnailEligible: true }]);
    expect(plan.deletions).toEqual([]);
    expect(plan.bytesToDownload).toBe(2_000_000);
  });

  it('6. rows without dropbox_file_id are never deleted, even when absent from the listing', () => {
    const db = [row('manual', null, 'upload.jpg'), row('p1', 'f1', 'a.jpg')];
    const plan = computeSyncPlan(complete(db), complete([file('f1', 'a.jpg')]));
    expect(plan.deletions).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('a synced row missing from a complete listing is a soft deletion', () => {
    const db = liveSynced(3);
    const plan = computeSyncPlan(complete(db), complete(listingOf(db).slice(1)));
    expect(plan.deletions).toEqual([{ photoId: 'p0', name: 'IMG_000.jpg' }]);
  });

  it('8. a soft-deleted row whose id reappears is a restore, not an addition', () => {
    const db = [row('p1', 'f1', 'a.jpg', 'r1', '2026-01-01T00:00:00Z')];
    const plan = computeSyncPlan(complete(db), complete([file('f1', 'a.jpg', 'r1')]));
    expect(plan.restores).toEqual([{ photoId: 'p1', file: file('f1', 'a.jpg'), needsDownload: false, thumbnailEligible: true }]);
    expect(plan.additions).toEqual([]);
    expect(plan.bytesToDownload).toBe(0);
  });

  it('a restore with a changed rev needs a download', () => {
    const db = [row('p1', 'f1', 'a.jpg', 'r1', '2026-01-01T00:00:00Z')];
    const plan = computeSyncPlan(complete(db), complete([file('f1', 'a.jpg', 'r2')]));
    expect(plan.restores[0].needsDownload).toBe(true);
    expect(plan.bytesToDownload).toBe(1_000_000);
  });

  it('9. a soft-deleted row still absent is not deleted again and not counted as live', () => {
    const db = [row('p1', 'f1', 'a.jpg', 'r1', '2026-01-01T00:00:00Z'), row('p2', 'f2', 'b.jpg')];
    const plan = computeSyncPlan(complete(db), complete([file('f2', 'b.jpg')]));
    expect(plan.deletions).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('10. duplicate ids in the listing: first wins, the rest are skipped, deterministically', () => {
    const listing = [file('f1', 'b.jpg'), file('f1', 'a.jpg')];
    const plan = computeSyncPlan(complete([]), complete(listing));
    expect(plan.additions.map((a) => a.file.name)).toEqual(['a.jpg']);
    expect(plan.skipped).toEqual([{ name: 'b.jpg', reason: 'duplicate_id' }]);
  });

  it('11. non-image and oversize entries are skipped and excluded from the byte total', () => {
    const listing = [
      file('f1', 'notes.txt'),
      file('f2', 'huge.jpg', 'r1', 60 * 1024 * 1024),
      file('f3', 'ok.jpg', 'r1', 500),
      { ...file('f4', 'noid.jpg'), id: '' },
    ];
    const plan = computeSyncPlan(complete([]), complete(listing));
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { name: 'notes.txt', reason: 'not_image' },
        { name: 'huge.jpg', reason: 'too_large' },
        { name: 'noid.jpg', reason: 'no_id' },
      ]),
    );
    expect(plan.additions.map((a) => a.file.id)).toEqual(['f3']);
    expect(plan.bytesToDownload).toBe(500);
  });

  it('marks files above the Dropbox thumbnail limit as not thumbnail-eligible without skipping them', () => {
    const plan = computeSyncPlan(complete([]), complete([file('f1', 'big.jpg', 'r1', 25 * 1024 * 1024)]));
    expect(plan.additions).toHaveLength(1);
    expect(plan.additions[0].thumbnailEligible).toBe(false);
  });
});

describe('computeSyncPlan - deletion threshold', () => {
  it('7. confirmation is off at the threshold and on just above it', () => {
    const db = liveSynced(100);
    // threshold = max(5, ceil(10% of 100)) = 10
    const tenMissing = computeSyncPlan(complete(db), complete(listingOf(db).slice(10)));
    expect(tenMissing.deletions).toHaveLength(10);
    expect(tenMissing.requiresTypedConfirmation).toBe(false);

    const elevenMissing = computeSyncPlan(complete(db), complete(listingOf(db).slice(11)));
    expect(elevenMissing.deletions).toHaveLength(11);
    expect(elevenMissing.requiresTypedConfirmation).toBe(true);
  });

  it('the minimum applies to small albums', () => {
    const db = liveSynced(8);
    // threshold = max(5, ceil(0.8)) = 5
    expect(computeSyncPlan(complete(db), complete(listingOf(db).slice(5))).requiresTypedConfirmation).toBe(false);
    expect(computeSyncPlan(complete(db), complete(listingOf(db).slice(6))).requiresTypedConfirmation).toBe(true);
  });
});

describe('computeSyncPlan - determinism and idempotency', () => {
  it('14. output ordering is stable across shuffled inputs', () => {
    const listing = [file('c', 'c.jpg'), file('a', 'a.jpg'), file('b', 'b.jpg')];
    const shuffled = [listing[1], listing[2], listing[0]];
    const a = computeSyncPlan(complete([]), complete(listing));
    const b = computeSyncPlan(complete([]), complete(shuffled));
    expect(a).toEqual(b);
    expect(a.additions.map((x) => x.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('12. applying a plan and recomputing yields an empty plan', () => {
    const db = [
      ...liveSynced(5),
      row('gone', 'fgone', 'gone.jpg'),
      row('old', 'fold', 'old.jpg', 'r1'),
      row('renamed', 'fren', 'before.jpg'),
      row('restored', 'fres', 'res.jpg', 'r1', '2026-01-01T00:00:00Z'),
      row('manual', null, 'manual.jpg'),
    ];
    const listing = [
      ...listingOf(liveSynced(5)),
      file('fold', 'old.jpg', 'r2'),
      file('fren', 'after.jpg'),
      file('fres', 'res.jpg', 'r1'),
      file('fnew', 'new.jpg'),
    ];

    const first = computeSyncPlan(complete(db), complete(listing), DEFAULT_SYNC_OPTIONS);
    expect(first.additions).toHaveLength(1);
    expect(first.updates).toHaveLength(1);
    expect(first.renames).toHaveLength(1);
    expect(first.restores).toHaveLength(1);
    expect(first.deletions).toEqual([{ photoId: 'gone', name: 'gone.jpg' }]);

    const after = applyPlanToRows(db, first, (f) => `new-${f.id}`);
    const second = computeSyncPlan(complete(after), complete(listing), DEFAULT_SYNC_OPTIONS);

    expect(second.additions).toEqual([]);
    expect(second.updates).toEqual([]);
    expect(second.renames).toEqual([]);
    expect(second.restores).toEqual([]);
    expect(second.deletions).toEqual([]);
    expect(second.unchanged).toBe(9); // 5 + updated + renamed + restored + new
    expect(second.requiresTypedConfirmation).toBe(false);
  });
});
