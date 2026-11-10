'use client';

import { useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, IconButton, UploadSimple, X } from '@/components/ui';
import { shrinkImage } from '@/lib/image';

/** Optional upload (photo or PDF) inside a sheet: a button, then the chosen file name. */
export function FilePick({ label, file, onFile, help }: { label: string; file: File | null; onFile: (f: File | null) => void; help?: string }) {
  const t = useTranslations('purchasing');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="an-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0] ?? null;
          onFile(f ? await shrinkImage(f) : null);
        }}
      />
      {file ? (
        <div className="row">
          <span className="grow body-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{file.name}</bdi>
          </span>
          <IconButton
            icon={X}
            label={t('file.remove')}
            onClick={() => {
              onFile(null);
              if (input.current) input.current.value = '';
            }}
          />
        </div>
      ) : (
        <Button icon={UploadSimple} onClick={() => input.current?.click()}>
          {t('file.choose')}
        </Button>
      )}
      <span className="an-help">{help ?? t('file.help')}</span>
    </div>
  );
}
