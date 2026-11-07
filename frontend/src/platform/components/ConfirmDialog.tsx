import { KeyboardEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  /** The question, e.g. "Delete 13 transactions?" */
  title: string;
  /** What it means, e.g. what is deleted. */
  message?: ReactNode;
  /** The button that goes ahead, e.g. "Delete". */
  confirmLabel?: string;
  /** Something that can't be undone: a red button, and Cancel has the focus. */
  danger?: boolean;
}

/**
 * Asks before going ahead, in the app's own dialog: a browser's confirm() can't be styled and shows the site's address
 * as its title. `confirm` resolves to whether the user went ahead; render `dialog` in the page.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [asking, setAsking] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setAsking({ ...options, resolve })), []);
  const close = (ok: boolean) => {
    asking?.resolve(ok);
    setAsking(null);
  };
  return { confirm, dialog: asking ? <ConfirmDialog {...asking} onClose={close} /> : null };
}

function ConfirmDialog({ title, message, confirmLabel = 'OK', danger = false, onClose }: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);

  // the safe choice has the focus; it goes back where it was when the dialog closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (danger ? cancel : ok).current?.focus();
    return () => before?.focus?.();
  }, [danger]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose(false);
    } else if (e.key === 'Tab') {
      // the focus stays on the dialog's two buttons
      e.preventDefault();
      (document.activeElement === cancel.current ? ok : cancel).current?.focus();
    }
  };

  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={message ? `${id}-message` : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`} className="confirm-title">
          {title}
        </h2>
        {message && (
          <div id={`${id}-message`} className="confirm-message">
            {message}
          </div>
        )}
        <div className="confirm-actions">
          <button ref={cancel} type="button" className="btn btn-outline-secondary" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button ref={ok} type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
