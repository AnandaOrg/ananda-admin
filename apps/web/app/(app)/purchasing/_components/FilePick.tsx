'use client';

import { FileUpload } from '@/components/ui';
import { shrinkImage } from '@/lib/image';

/**
 * Optional upload (photo or PDF) inside a panel, built on the shared FileUpload: a drop zone on desktop,
 * Take a photo and Choose a file on phones; too big and wrong type show on the file row.
 */
export function FilePick({ label, file, onFile }: { label?: string; file: File | null; onFile: (f: File | null) => void; /** Kept for older callers; the shared FileUpload has one look. */ placeholder?: string; zone?: boolean }) {
  return (
    <div className="an-field">
      {label && <label>{label}</label>}
      <FileUpload file={file} status={file ? 'ready' : 'idle'} onPick={async (f) => onFile(await shrinkImage(f))} onRemove={() => onFile(null)} />
    </div>
  );
}
