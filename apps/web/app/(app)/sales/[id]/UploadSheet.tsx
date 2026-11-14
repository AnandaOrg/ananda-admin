'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ORDER_UPLOAD_KINDS, type OrderUploadKind } from '@ananda/shared';
import { ApiError, api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, FileUpload, Sheet, TextField, UploadSimple } from '@/components/ui';
import { Picker } from '../ui';
import type { OrderDetail } from './page';

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
  useEffect(() => {
    if (!open) return;
    setKind(null);
    setDescription('');
    setFile(null);
  }, [open]);
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
        <FileUpload
          file={file}
          status={networkFail ? 'error' : file ? 'ready' : 'idle'}
          error={networkFail ? 'stopped' : undefined}
          onPick={setFile}
          onRemove={() => setFile(null)}
          onRetry={() => send.mutate(undefined)}
        />
        {send.fields.file && <span className="an-help error">{send.fields.file}</span>}
      </div>
      <span className="sales-hint">{t('upload.privacy')}</span>
      {!networkFail && <ActionError action={send} />}
    </Sheet>
  );
}
