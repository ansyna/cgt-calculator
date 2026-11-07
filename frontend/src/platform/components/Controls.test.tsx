import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LocationProbe } from '../../test/helpers';
import { SegmentedControl, SelectControl, SwitchControl } from './Controls';

const SIZES: [string, string][] = [
  ['s', 'Small'],
  ['l', 'Large'],
];

describe('controls', () => {
  it('keep their value in the address, next to what is already there', () => {
    render(
      <MemoryRouter initialEntries={['/page?id=7']}>
        <Routes>
          <Route
            path="/page"
            element={
              <>
                <SegmentedControl name="size" label="Size" fallback="s" options={SIZES} />
                <SelectControl name="pick" label="Pick" fallback="s" options={SIZES} />
                <SwitchControl name="extra" label="Extra" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('radio', { name: 'Small' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'l' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Extra' }));
    expect(screen.getByTestId('location').textContent).toBe('/page?id=7&size=l&pick=l&extra=true');
    fireEvent.click(screen.getByRole('switch', { name: 'Extra' }));
    expect(screen.getByTestId('location').textContent).toBe('/page?id=7&size=l&pick=l');
  });
});
