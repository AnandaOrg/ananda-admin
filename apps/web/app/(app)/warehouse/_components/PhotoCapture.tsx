'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Camera, EmptyState } from '@/components/ui';

export interface PhotoCaptureHandle {
  /** Opens the camera (or the file picker on desktop). */
  open: () => void;
}

/**
 * Camera capture for the signed delivery note (FR-WH-3): the rear camera opens on phones,
 * the photo is previewed, and the sheet footer offers Retake or Use photo.
 */
export const PhotoCapture = forwardRef<PhotoCaptureHandle, { file: File | null; onFile: (f: File) => void; error?: string }>(function PhotoCapture({ file, onFile, error }, ref) {
  const t = useTranslations('warehouse');
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="stack">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t('photo.previewAlt')} className="photo-preview" />
      ) : (
        <EmptyState
          icon={Camera}
          title={t('photo.title')}
          text={t('photo.text')}
          action={
            <Button variant="primary" icon={Camera} onClick={() => input.current?.click()}>
              {t('photo.take')}
            </Button>
          }
        />
      )}
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
});
