import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { Schemas } from '../types';

/** A reset or invitation link; the url is absolute when the server knows its public address. */
export type LinkResult = Omit<Schemas['LinkDto'], 'user'>;

/** A link for the admin to pass on, with a copy button and whether the app already emailed it. */
export default function ShareLink({ link, to, what }: { link: LinkResult; to: string; what: string }) {
  const url = link.url ?? `${window.location.origin}${link.path}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // clipboard blocked: the field is selectable
    }
  };
  return (
    <div className="share-link" role="status">
      <p>
        {link.emailed ? (
          <>
            We emailed the {what} to <strong>{to}</strong>. You can also share this link yourself:
          </>
        ) : (
          <>
            Email isn't set up, so send this {what} to <strong>{to}</strong> yourself (it works once):
          </>
        )}
      </p>
      <div className="input-group">
        <input className="form-control" readOnly value={url} aria-label={`${what} link`} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-outline-primary" onClick={copy}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
