'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, DownloadSimple, FileText } from '@/components/ui';
import { shrinkImage } from '@/lib/image';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/**
 * Optional upload (photo or PDF) inside a panel. `zone`: a dashed drop area; `field`: an input that
 * says "Drop a PDF". Both take a click or a dropped file; once chosen, the file shows with Remove.
 */
export function FilePick({ label, file, onFile, placeholder, zone }: { label?: string; file: File | null; onFile: (f: File | null) => void; placeholder?: string; zone?: boolean }) {
  const t = useTranslations('purchasing');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = async (f: File | null | undefined) => onFile(f ? await shrinkImage(f) : null);
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      void take(e.dataTransfer.files?.[0]);
    },
  };
  return (
    <div className="an-field">
      {label && <label htmlFor={id}>{label}</label>}
      <input id={id} ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void take(e.target.files?.[0])} />
      {file ? (
        <div className="an-doc" style={{ borderTop: 0, paddingBlock: 0 }}>
          <span className="ico" style={{ color: 'var(--good)' }}>
            <FileText className="an-ic" aria-hidden />
          </span>
          <span>
            <span className="t" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <bdi>{file.name}</bdi>
            </span>
            <span className="sub">{t('file.ready')}</span>
          </span>
          <Button
            size="sm"
            onClick={() => {
              onFile(null);
              if (input.current) input.current.value = '';
            }}
          >
            {t('file.remove')}
          </Button>
        </div>
      ) : zone ? (
        <button
          type="button"
          className="an-input"
          onClick={() => input.current?.click()}
          {...drop}
          style={{ minHeight: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', borderStyle: 'dashed', color: 'var(--text-muted)', borderColor: over ? 'var(--accent)' : undefined, textAlign: 'center', cursor: 'pointer' }}
        >
          <DownloadSimple className="an-ic" aria-hidden />
          <span>{placeholder ?? t('file.zone')}</span>
        </button>
      ) : (
        <button type="button" className="an-input" onClick={() => input.current?.click()} {...drop} style={{ textAlign: 'start', color: 'var(--text-subtle)', cursor: 'pointer', borderColor: over ? 'var(--accent)' : undefined }}>
          {placeholder ?? t('file.dropPdf')}
        </button>
      )}
    </div>
  );
}
