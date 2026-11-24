import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewingTips, { TIPS_STORAGE_KEY } from './ViewingTips';

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ViewingTips', () => {
  it('gives a phone the three steps plus viewer and free-viewing guidance', () => {
    render(<ViewingTips device="phone" />);
    expect(screen.getByText(/Turn your phone sideways/)).toBeInTheDocument();
    expect(screen.getByText(/Tap a photo/)).toBeInTheDocument();
    expect(screen.getByText(/Pinch to zoom, drag to pan/)).toBeInTheDocument();
    expect(screen.getByText(/In a phone viewer or headset/)).toBeInTheDocument();
    expect(screen.getByText(/Without a viewer/)).toBeInTheDocument();
  });

  it('leaves out viewer and free-viewing guidance on a tablet, where they do not work', () => {
    render(<ViewingTips device="tablet" />);
    expect(screen.getByText(/Turn your tablet sideways/)).toBeInTheDocument();
    expect(screen.queryByText(/phone viewer or headset/)).toBeNull();
    expect(screen.queryByText(/Without a viewer/)).toBeNull();
  });

  it('shows nothing on a desktop', () => {
    const { container } = render(<ViewingTips device="desktop" />);
    expect(container.innerHTML).toBe('');
  });

  it('stays dismissed on this device after "Got it"', () => {
    const { unmount } = render(<ViewingTips device="phone" />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/Viewing tips/)).toBeNull();
    expect(store.get(TIPS_STORAGE_KEY)).toBe('1');
    unmount();
    const { container } = render(<ViewingTips device="phone" />);
    expect(container.innerHTML).toBe('');
  });
});
