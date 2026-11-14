'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/ui';
import { shrinkImage } from '@/lib/image';

/**
 * Photo of the signed delivery note (FR-WH-3): the shared FileUpload (Take a photo and Choose a file on
 * phones, a drop zone on desktop), then a preview of the chosen photo. The sheet footer has Use photo.
 */
export function PhotoCapture({ file, onFile, onRemove, error }: { file: File | null; onFile: (f: File) => void; onRemove: () => void; error?: string }) {
  const t = useTranslations('warehouse');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="stack">
      <FileUpload
        file={file}
        status={file ? 'ready' : 'idle'}
        // Keep uploads under the hosting request limit; the note stays legible at 2000 px.
        onPick={async (f) => onFile(await shrinkImage(f))}
        onRemove={onRemove}
      />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t('photo.previewAlt')} className="photo-preview" />
      )}
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
}
