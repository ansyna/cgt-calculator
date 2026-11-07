import { useSearchParams } from 'react-router';

/** A URL query parameter used as page state (ticker, frequency, ...), so views are linkable. */
export function useParam(name: string, fallback = ''): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(name) ?? fallback;
  const setValue = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set(name, next);
    else params.delete(name);
    setSearchParams(params);
  };
  return [value, setValue];
}

export function SegmentedControl({ name, label, options, fallback }: { name: string; label: string; options: [string, string][]; fallback: string }) {
  const [value, setValue] = useParam(name, fallback);
  return (
    <div className="control">
      <span className="control-label" id={`${name}-label`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${name}-label`}>
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={value === option ? 'active' : ''}
            onClick={() => setValue(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectControl({ name, label, options, fallback }: { name: string; label: string; options: [string, string][]; fallback: string }) {
  const [value, setValue] = useParam(name, fallback);
  return (
    <div className="control">
      <label className="control-label" htmlFor={`control-${name}`}>
        {label}
      </label>
      <select id={`control-${name}`} className="form-select form-select-sm" value={value} onChange={(e) => setValue(e.target.value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SwitchControl({ name, label }: { name: string; label: string }) {
  const [value, setValue] = useParam(name);
  return (
    <div className="control form-check form-switch">
      <input
        id={`control-${name}`}
        className="form-check-input"
        type="checkbox"
        role="switch"
        checked={value === 'true'}
        onChange={(e) => setValue(e.target.checked ? 'true' : '')}
      />
      <label className="form-check-label" htmlFor={`control-${name}`}>
        {label}
      </label>
    </div>
  );
}
