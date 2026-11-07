import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from './ConfirmDialog';

function Asker() {
  const { confirm, dialog } = useConfirm();
  const [answer, setAnswer] = useState('none');
  return (
    <>
      <button type="button" onClick={async () => setAnswer(String(await confirm({ title: 'Delete it?', message: 'For good.', confirmLabel: 'Delete', danger: true })))}>
        Ask
      </button>
      <output>{answer}</output>
      {dialog}
    </>
  );
}

describe('the confirmation dialog', () => {
  it('asks in the page, with the safe choice focused, and answers', async () => {
    render(<Asker />);
    const ask = screen.getByRole('button', { name: 'Ask' });
    ask.focus();
    fireEvent.click(ask);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete it?' });
    expect(within(dialog).getByText('For good.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    // Tab keeps the focus in the dialog
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('true')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // the focus goes back
    expect(document.activeElement).toBe(ask);
  });

  it('is cancelled with Escape or a tap outside it', async () => {
    render(<Asker />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.keyDown(await screen.findByRole('alertdialog'), { key: 'Escape' });
    expect(await screen.findByText('false')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.mouseDown((await screen.findByRole('alertdialog')).parentElement as HTMLElement);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('false')).toBeTruthy();
  });
});
