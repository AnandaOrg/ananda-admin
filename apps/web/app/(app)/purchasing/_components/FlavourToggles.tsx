'use client';

import { FLAVOURS, type Flavour } from '@ananda/shared';

/** Pick several flavours; always in the order Aloha, Gaia, Santorini, Kyoto, each with its colour. */
export function FlavourToggles({ label, value, onChange, only, help, error, readOnly }: { readOnly?: boolean; label: string; value: Flavour[]; onChange: (v: Flavour[]) => void; only?: Flavour[]; help?: string; error?: string }) {
  const list = FLAVOURS.filter((f) => !only || only.includes(f));
  return (
    <div className="an-field">
      <span className="overline">{label}</span>
      <div className="an-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
        {list.map((f) => {
          const on = value.includes(f);
          return (
            <button key={f} type="button" className="an-chip" aria-pressed={on} style={readOnly ? { cursor: 'default' } : undefined} disabled={readOnly && !on ? false : undefined} onClick={() => !readOnly && onChange(on ? value.filter((x) => x !== f) : FLAVOURS.filter((x) => x === f || value.includes(x)))}>
              {f.toUpperCase()}
            </button>
          );
        })}
      </div>
      {error ? <span className="an-help error">{error}</span> : help ? <span className="an-help">{help}</span> : null}
    </div>
  );
}
