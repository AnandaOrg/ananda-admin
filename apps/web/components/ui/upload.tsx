'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMedia } from '@/lib/media';
import { iso } from '@/lib/format';
import { Camera, FileText, Icon, UploadSimple, WarningCircle, X, Check } from './icon';

export type UploadError = 'tooBig' | 'wrongType' | 'stopped';

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];

/**
 * File upload (design system FileUpload): empty drop zone (desktop) or two buttons (phone), then a file
 * row with its state. Too big / wrong type are checked here and shown inline on the row with
 * "Choose another file"; `status="error"` + `error="stopped"` shows "The connection dropped." + Try again
 * (`onRetry` sends the same file again). The parent owns the upload itself:
 *
 *   <FileUpload file={file} status={status} progress={pct} onPick={(f) => { setFile(f); start(f); }}
 *               onRemove={() => setFile(null)} onRetry={() => start(file!)} />
 */
export function FileUpload({ file, status = 'idle', progress, error, onPick, onRemove, onRetry, maxMb = 10, name, size, imageOnly }: { /** Logo-style uploads: images only (JPG, PNG, HEIC). */ imageOnly?: boolean; file?: File | null; status?: 'idle' | 'uploading' | 'ready' | 'error'; progress?: number; error?: UploadError; onPick: (f: File) => void; onRemove?: () => void; onRetry?: () => void; maxMb?: number; /** Show a file that is already stored (no File object). */ name?: string; size?: number }) {
  const t = useTranslations('common');
  const phone = useMedia('(max-width: 767px)');
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [bad, setBad] = useState<{ name: string; size: number; error: UploadError } | null>(null);
  const choose = () => input.current?.click();
  const take = (f?: File | null) => {
    if (!f) return;
    const okType = (imageOnly ? f.type.startsWith('image/') : TYPES.includes(f.type)) || /\.(pdf|jpe?g|png|heic|heif)$/i.test(f.name);
    if (!okType) return setBad({ name: f.name, size: f.size, error: 'wrongType' });
    if (f.size > maxMb * 1_000_000) return setBad({ name: f.name, size: f.size, error: 'tooBig' });
    setBad(null);
    onPick(f);
  };
  const hidden = (
    <>
      <input ref={input} type="file" hidden accept={imageOnly ? 'image/*' : '.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*'} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );
  const fname = bad?.name ?? file?.name ?? name;
  const fsize = bad?.size ?? file?.size ?? size;
  const err: UploadError | undefined = bad?.error ?? (status === 'error' ? (error ?? 'stopped') : undefined);
  const hint = <small>{t('upload.hint', { max: iso(`${maxMb} MB`) })}</small>;
  if (!fname) {
    return (
      <div className="stack tight" aria-live="polite">
        {hidden}
        {phone ? (
          <>
            <div className="an-panel-f">
              <button type="button" className="an-btn secondary" onClick={() => cam.current?.click()}>
                <Icon as={Camera} size="sm" />
                {t('upload.takePhoto')}
              </button>
              <button type="button" className="an-btn secondary" onClick={choose}>
                <Icon as={UploadSimple} size="sm" />
                {t('upload.chooseFile')}
              </button>
            </div>
            <span className="an-help">{t('upload.hint', { max: iso(`${maxMb} MB`) })}</span>
          </>
        ) : (
          <div
            className={`an-drop ${over ? 'over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={choose}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose())}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => (e.preventDefault(), setOver(false), take(e.dataTransfer.files?.[0]))}
          >
            <Icon as={UploadSimple} size="lg" />
            <span>{t.rich('upload.drop', { b: (c) => <b>{c}</b> })}</span>
            {hint}
          </div>
        )}
      </div>
    );
  }
  const detail = err ? (err === 'tooBig' ? t('errors.uploadTooBig', { size: iso(`${((fsize ?? 0) / 1_000_000).toFixed(1)}`), limit: iso(`${maxMb}`) }) : err === 'wrongType' ? t('errors.uploadWrongType') : t('errors.uploadStopped')) : status === 'uploading' ? t('upload.uploading') : status === 'ready' ? t('upload.ready', { size: fsize ? `${Math.max(1, Math.round(fsize / 1000))} KB` : '' }) : fsize ? `${Math.max(1, Math.round(fsize / 1000))} KB` : '';
  return (
    <div className="stack tight" aria-live="polite">
      {hidden}
      <div className={`an-file ${err ? 'error' : status === 'ready' ? 'done' : ''}`}>
        <span className="fi">{err ? <Icon as={WarningCircle} /> : status === 'uploading' ? <span className="an-spin sm" aria-hidden /> : status === 'ready' ? <Icon as={Check} /> : <Icon as={FileText} />}</span>
        <span className="tx">
          <span className="t">{fname}</span>
          <span className="sub">{detail}</span>
          {status === 'uploading' && !err && (
            <span className="bar" aria-hidden>
              <i style={{ width: `${Math.max(4, Math.min(100, progress ?? 30))}%` }} />
            </span>
          )}
        </span>
        {status !== 'uploading' && onRemove && (
          <button type="button" className="x" aria-label={t('upload.remove')} onClick={() => { setBad(null); onRemove(); }}>
            <Icon as={X} size="sm" />
          </button>
        )}
      </div>
      {err && (
        <button type="button" className="an-flink" onClick={err === 'stopped' && onRetry ? onRetry : () => { setBad(null); choose(); }}>
          {err === 'stopped' ? t('retry') : t('errors.chooseAnother')}
        </button>
      )}
    </div>
  );
}
