'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { shrinkImage } from '@/lib/image';

export interface PhotoCaptureHandle {
  /** Opens the camera (or the file picker on desktop). */
  open: () => void;
}

/**
 * Camera capture for the signed delivery note (FR-WH-3): a framed area asks to point the camera at
 * the note; the rear camera opens on phones, the photo is previewed, and the sheet footer offers
 * Take photo, then Retake or Use photo.
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
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          // Keep uploads under the hosting request limit; the note stays legible at 2000 px.
          if (f) onFile(await shrinkImage(f));
        }}
      />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t('photo.previewAlt')} className="photo-preview" />
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            width: '100%',
            height: 360,
            maxHeight: '45dvh',
            padding: 'var(--space-5)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--line)',
            background: 'var(--bg)',
            color: 'var(--text-muted)',
            font: '400 14px/20px var(--font-sans)',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden style={{ position: 'absolute', inset: 18, border: '2px dashed var(--surface-3)', borderRadius: 'var(--radius-md)' }} />
          <span style={{ position: 'relative', maxWidth: 220 }}>{t('photo.point')}</span>
        </button>
      )}
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
});
