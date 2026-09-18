import { describe, expect, it } from 'vitest';
import { makeSlug } from '@/services/galleryService';

describe('makeSlug', () => {
  it("drops apostrophes instead of turning them into separators", () => {
    // The customer's own example. Previously produced ben-and-isabel-s-wedding.
    expect(makeSlug("Ben and Isabel's Wedding")).toBe('ben-and-isabels-wedding');
  });

  it('handles typographic apostrophes the same way', () => {
    expect(makeSlug('Ben and Isabel’s Wedding')).toBe('ben-and-isabels-wedding');
  });

  it('collapses other punctuation and whitespace into single dashes', () => {
    expect(makeSlug('  Summer / Autumn --- 2026!  ')).toBe('summer-autumn-2026');
  });

  it('is idempotent, so the DB trigger re-slugifying a clean slug is a no-op', () => {
    const once = makeSlug("Ben and Isabel's Wedding");
    expect(makeSlug(once)).toBe(once);
  });

  it('returns an empty string for input with nothing slug-worthy', () => {
    expect(makeSlug('!!!')).toBe('');
  });
});
