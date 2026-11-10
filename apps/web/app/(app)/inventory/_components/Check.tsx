'use client';

import type { ReactNode } from 'react';

/** A row with a checkbox at the start (the Allocate list). The whole row toggles. */
export function CheckRow({ checked, onChange, title, sub, end, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: ReactNode; sub?: ReactNode; end?: ReactNode; disabled?: boolean }) {
  return (
    <label className="an-lrow clk" style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : undefined }}>
      <span className="ico" style={{ display: 'grid', placeItems: 'center' }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--accent)', cursor: 'inherit' }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      {end && <span className="v">{end}</span>}
    </label>
  );
}
