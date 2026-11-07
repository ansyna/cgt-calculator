import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatCard, { formatCompact, formatPrice } from './StatCard';

describe('StatCard', () => {
  it('shows label, value and hint with a tone', () => {
    const { container } = render(<StatCard label="MOS price" value="43.07" hint="Buy-below price" tone="positive" emphasis />);
    expect(screen.getByText('MOS price')).toBeTruthy();
    expect(screen.getByText('43.07')).toBeTruthy();
    expect(screen.getByText('Buy-below price')).toBeTruthy();
    expect(container.firstElementChild?.className).toBe('stat-card tone-positive stat-emphasis');
  });

  it('formats amounts compactly and prices with two decimals', () => {
    expect(formatCompact(2905000000000)).toBe('2.91T');
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact('')).toBe('—');
    expect(formatCompact(null)).toBe('—');
    expect(formatPrice(187.4)).toBe('187.40');
    expect(formatPrice(1234.567)).toBe('1,234.57');
    expect(formatPrice('-')).toBe('-');
  });
});
