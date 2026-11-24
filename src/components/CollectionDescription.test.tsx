import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CollectionDescription from './CollectionDescription';

describe('CollectionDescription', () => {
  it('shows the description as typed, line breaks kept', () => {
    render(<CollectionDescription text={'Golden Gate Park\nOctober 2026'} />);
    const text = screen.getByText(/Golden Gate Park/);
    expect(text.textContent).toBe('Golden Gate Park\nOctober 2026');
    expect(text.className).toContain('whitespace-pre-line');
  });

  it('shows nothing when the field is empty or only spaces', () => {
    const { container: none } = render(<CollectionDescription text={null} />);
    const { container: blank } = render(<CollectionDescription text={'  \n '} />);
    expect(none.innerHTML).toBe('');
    expect(blank.innerHTML).toBe('');
  });
});
