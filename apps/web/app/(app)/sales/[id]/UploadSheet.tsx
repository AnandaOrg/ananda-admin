'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ORDER_UPLOAD_KINDS, ORDER_UPLOAD_MAX_BYTES, type OrderUploadKind } from '@ananda/shared';
import { ApiError, api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, Camera, FileText, Icon, Sheet, TextField, UploadSimple } from '@/components/ui';
import { Picker } from '../ui';
import type { OrderDetail } from './page';

const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/jpeg,image/png,image/heic,image/webp';

function kindOfFile(f: File) {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  if (['doc', 'docx'].includes(ext)) return 'Word';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Excel';
  return ext.toUpperCase() || f.type;
}

/**
 * A broker uploads a document to their own order: the customer's purchase order, a signed order,
 * proof of payment, a delivery photo or signed note, or something else. On the phone the camera
 * opens directly. A proof of payment never confirms the payment: the Admin checks the bank.
 */
export function UploadSheet({ open, detail, onClose }: { open: boolean; detail: OrderDetail; onClose: () => void }) {
  const t = useTranslations('sales');
  const [kind, setKind] = useState<OrderUploadKind | null>(null);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setDescription('');
    setFile(null);
    setFileError(null);
  }, [open]);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || file.type.includes('heic')) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    if (!OK_TYPES.includes(f.type) && !/\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(f.name)) {
      setFile(null);
      setFileError(t('upload.wrongType', { kind: kindOfFile(f) }));
      return;
    }
    if (f.size > ORDER_UPLOAD_MAX_BYTES) {
      setFile(null);
      setFileError(t('upload.tooBig', { size: (f.size / 1024 / 1024).toFixed(1) }));
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const send = useAction(
    async () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('kind', kind!);
      if (description.trim()) fd.append('description', description.trim());
      return api.post(`/orders/${detail.order.id}/uploads`, fd);
    },
    { success: t('upload.done'), onDone: onClose },
  );
  const networkFail = send.error instanceof ApiError && send.error.status === 0;
  const ready = !!kind && !!file && (kind !== 'other' || !!description.trim());

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files?.[0]);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={!!file || !!description}
      title={t('upload.title')}
      sub={t('upload.sub', { number: detail.order.number, customer: detail.customer?.companyName ?? '' })}
      footer={
        <Button variant="primary" block icon={UploadSimple} disabled={!ready} busy={send.isPending} onClick={() => send.mutate(undefined)}>
          {send.isPending ? t('upload.uploading') : t('upload.cta')}
        </Button>
      }
    >
      <div className="stack tight">
        <Picker label={t('upload.what')} value={kind} placeholder={t('upload.choose')} options={ORDER_UPLOAD_KINDS.map((k) => ({ value: k, label: t(`docs.kinds.${k}`) }))} onChange={(k) => setKind(k as OrderUploadKind)} error={send.fields.kind} />
        {kind && <span className="sales-hint">{t(`upload.help.${kind}`)}</span>}
      </div>
      {kind === 'other' && <TextField label={t('upload.description')} placeholder={t('upload.descriptionPh')} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} error={send.fields.description} />}

      <div className="an-field">
        <label>{t('upload.file')}</label>
        <input ref={pick} type="file" accept={ACCEPT} hidden onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
        {file ? (
          <div className="sales-file">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" />
            ) : (
              <span className="ico">
                <Icon as={FileText} />
              </span>
            )}
            <span style={{ minWidth: 0 }}>
              <b>{file.name}</b>
              <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
            </span>
            <button type="button" className="an-errlink" onClick={() => pick.current?.click()}>
              {t('upload.another')}
            </button>
          </div>
        ) : (
          <>
            <div
              className={`sales-drop only-wide ${over ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <Icon as={UploadSimple} size="lg" />
              <span>
                {t('upload.drop')}{' '}
                <button type="button" className="linkish" onClick={() => pick.current?.click()}>
                  {t('upload.chooseFile')}
                </button>
              </span>
            </div>
            <div className="only-phone sales-row2">
              <Button icon={Camera} onClick={() => cam.current?.click()}>
                {t('upload.takePhoto')}
              </Button>
              <Button icon={FileText} onClick={() => pick.current?.click()}>
                {t('upload.chooseFileBtn')}
              </Button>
            </div>
          </>
        )}
        {(fileError || send.fields.file) && <span className="an-help error">{fileError ?? send.fields.file}</span>}
      </div>
      <span className="sales-hint">{t('upload.privacy')}</span>
      <ActionError action={send} message={networkFail ? t('upload.stopped') : undefined} />
    </Sheet>
  );
}
