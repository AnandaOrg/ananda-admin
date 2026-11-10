'use client';

import { FLAVOURS, type Flavour } from '@ananda/shared';
import { FLAVOUR_VAR } from '@/components/ui';

/** Pick several flavours; always in the order Aloha, Gaia, Santorini, Kyoto, each with its colour. */
export function FlavourToggles({ label, value, onChange, only, help, error }: { label: string; value: Flavour[]; onChange: (v: Flavour[]) => void; only?: Flavour[]; help?: string; error?: string }) {
  const list = FLAVOURS.filter((f) => !only || only.includes(f));
  return (
    <div className="an-field">
      <label>{label}</label>
      <div className="an-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
        {list.map((f) => {
          const on = value.includes(f);
          return (
            <button key={f} type="button" className="an-chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== f) : FLAVOURS.filter((x) => x === f || value.includes(x)))}>
              <i className="flav-dot" style={{ background: FLAVOUR_VAR[f], marginInlineEnd: 6 }} aria-hidden />
              {f.toUpperCase()}
            </button>
          );
        })}
      </div>
      {error ? <span className="an-help error">{error}</span> : help ? <span className="an-help">{help}</span> : null}
    </div>
  );
}
