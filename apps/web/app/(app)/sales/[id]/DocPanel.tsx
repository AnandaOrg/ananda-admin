'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PAPER_CSS, paperHtml, paperPage, paymentPaper, warehousePaper, type PaperSpec } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, DownloadSimple, EnvelopeSimple, Eye, FileText, Icon, LoadError, Sheet, Sk, TextArea, TextField } from '@/components/ui';
import type { OrderDetail, OrderDoc } from './page';

export type DocItem =
  | { kind: 'doc'; doc: OrderDoc; replacedBy?: string | null }
  | { kind: 'file'; doc: OrderDoc }
  | { kind: 'payment'; payment: OrderDetail['payments'][number]; proforma: string | null }
  | { kind: 'warehouse' };

/** The paper, exactly as it is printed and e-mailed (one layout for every viewer). */
export function Paper({ spec }: { spec: PaperSpec }) {
  return (
    <>
      <style>{PAPER_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: paperHtml(spec) }} />
    </>
  );
}

function printPaper(spec: PaperSpec, title: string) {
  const abs = spec.logo && spec.logo.startsWith('/') ? { ...spec, logo: window.location.origin + spec.logo } : spec;
  const url = URL.createObjectURL(new Blob([paperPage(abs, { title, autoPrint: true })], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Document panel: every proforma, invoice, credit note, payment, warehouse order and upload on the same paper. */
export function DocPanel({ item, detail, onClose }: { item: (DocItem & { title?: string }) | null; detail: OrderDetail; onClose: () => void }) {
  const t = useTranslations('sales');
  const { date } = useFmt();
  const [mail, setMail] = useState(false);
  const docId = item && item.kind === 'doc' ? item.doc.id : null;
  const full = useQuery({ queryKey: ['documents', docId, 'paper'], queryFn: () => api.get<{ spec: PaperSpec }>(`/documents/${docId}/paper`), enabled: !!docId });
  useEffect(() => setMail(false), [item]);
  if (!item) return null;

  const lang = detail.paper.language ?? detail.customer?.proformaLanguage ?? 'en';
  const brand = detail.paper.brand ?? {};
  const o = detail.order;
  let title = '';
  let spec: PaperSpec | null = null;
  if (item.kind === 'doc') {
    const x = item.doc;
    title = x.type === 'proforma' ? (x.replaces ? t('docs.correctedProforma', { number: x.number ?? '' }) : t('docs.proforma', { number: x.number ?? '' })) : x.type === 'invoice' ? t('docs.invoice', { number: x.number ?? '' }) : t('docs.creditNote', { number: x.number ?? '' });
    if (full.data) spec = full.data.spec;
  } else if (item.kind === 'payment') {
    const p = item.payment;
    const paidBefore = detail.payments.filter((x) => x.createdAt <= p.createdAt).reduce((s, x) => s + x.amountCents, 0);
    spec = paymentPaper({
      ...brand,
      lang,
      company: detail.paper.company,
      bank: detail.paper.bank,
      no: `RCPT-${o.number.replace(/^S-/, '')}${detail.payments.length > 1 ? `-${detail.payments.indexOf(p) + 1}` : ''}`,
      orderNumber: o.number,
      receivedOn: p.receivedOn,
      customerName: detail.customer?.companyName ?? '',
      proforma: item.proforma,
      method: p.method,
      reference: p.bankReference,
      amountCents: p.amountCents,
      stillToPayCents: o.totalCents - o.creditedCents - paidBefore,
      confirmedBy: p.confirmedByName ?? '',
    });
    title = item.title ?? spec.no;
  } else if (item.kind === 'warehouse') {
    title = t('docs.warehouse');
    spec = warehousePaper({
      ...brand,
      lang,
      company: detail.paper.company,
      orderNumber: o.number,
      date: o.sentToWarehouseAt ?? o.createdAt,
      customerName: detail.customer?.companyName ?? '',
      address: detail.customer?.deliveryAddress ?? '',
      contact: [detail.customer?.contactName, detail.customer?.phone].filter(Boolean).join(' · '),
      lines: detail.lines.map((l) => ({ flavour: l.flavour, cartons: l.cartons })),
    });
  }

  if (item.kind === 'file') {
    const x = item.doc;
    const name = x.type === 'delivery_note' ? t('docs.deliveryNote') : x.uploadKind ? t(`docs.kinds.${x.uploadKind}`) : (x.label ?? '');
    const href = `/api/documents/${x.id}/file`;
    const image = (x.mimeType ?? '').startsWith('image/') && x.mimeType !== 'image/heic';
    const by = x.type === 'delivery_note' ? null : x.createdByName;
    return (
      <Sheet
        open
        onClose={onClose}
        title={name}
        sub={x.description ?? undefined}
        footer={
          <>
            <a className="an-btn secondary" href={href} download={x.fileName ?? true}>
              <Icon as={DownloadSimple} size="sm" />
              {t('docs.downloadFile')}
            </a>
            <a className="an-btn primary" href={href} target="_blank" rel="noreferrer">
              <Icon as={Eye} size="sm" />
              {t('docs.openFile')}
            </a>
          </>
        }
      >
        <style>{PAPER_CSS}</style>
        <div className="pp">
          <div className="pp-h">
            <div>
              <b className="pp-logo">ANANDA</b>
              <span>{t('docs.uploadedFile')}</span>
            </div>
          </div>
          <div className="pp-up">
            {image ? <img src={href} alt={x.fileName ?? name} /> : x.mimeType === 'application/pdf' ? <iframe className="sales-paper-file" src={href} title={x.fileName ?? name} /> : <Icon as={FileText} size="lg" />}
            <b>{x.fileName}</b>
            <span>{by ? t('docs.uploadedByOn', { name: by, date: date(x.createdAt) }) : `${date(x.createdAt)}`}</span>
          </div>
          <div className="pp-f">{t('docs.fileFoot')}</div>
        </div>
        {x.uploadKind === 'payment_proof' && <div className="sales-note">{t('docs.paymentNotice')}</div>}
      </Sheet>
    );
  }

  const canMail = item.kind === 'doc';
  const filename = item.kind === 'doc' ? (item.doc.number ?? title) : (spec?.no ?? title);
  return (
    <>
      <Sheet
        open={!mail}
        onClose={onClose}
        title={title}
        sub={spec ? t('docs.panelSub', { type: spec.type, ref: spec.ref ?? '' }) : undefined}
        footer={
          spec && (
            <>
              <Button icon={DownloadSimple} keep onClick={() => (item.kind === 'doc' ? window.open(`/api/documents/${item.doc.id}/print?print=1`, '_blank', 'noopener') : printPaper(spec!, filename))}>
                {t('docs.download')}
              </Button>
              {canMail && (
                <Button variant="primary" icon={EnvelopeSimple} onClick={() => setMail(true)}>
                  {t('docs.emailIt')}
                </Button>
              )}
            </>
          )
        }
      >
        {spec ? (
          <Paper spec={spec} />
        ) : full.error ? (
          <LoadError error={full.error} onRetry={() => full.refetch()} />
        ) : (
          <div className="stack tight" aria-busy>
            <Sk w="60%" h={16} />
            <Sk w="100%" h={240} />
          </div>
        )}
      </Sheet>
      {mail && item.kind === 'doc' && <MailSheet doc={item.doc} title={title} to={detail.customer?.invoiceEmail ?? ''} onClose={() => setMail(false)} />}
    </>
  );
}

/** E-mail a document again: To, Subject and Message, sent from ANANDA's address; a copy stays on the order. */
function MailSheet({ doc, title, to: initialTo, onClose }: { doc: OrderDoc; title: string; to: string; onClose: () => void }) {
  const t = useTranslations('sales');
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(title);
  const [message, setMessage] = useState(t('mail.body', { name: title }));
  const send = useAction(() => api.post(`/documents/${doc.id}/email`, { to: to.split(/[,;\s]+/).filter(Boolean), subject, message }), { success: t('mail.sent', { to }), onDone: onClose });
  return (
    <Sheet
      open
      onClose={onClose}
      dirty
      title={t('mail.heading')}
      footer={
        <>
          <Button keep onClick={onClose}>
            {t('mail.discard')}
          </Button>
          <Button variant="primary" icon={EnvelopeSimple} disabled={!to.trim() || !subject.trim() || !message.trim()} busy={send.isPending} onClick={() => send.mutate(undefined)}>
            {t('mail.send')}
          </Button>
        </>
      }
    >
      <TextField label={t('mail.to')} type="email" value={to} onChange={(e) => setTo(e.target.value)} error={send.fields.to} />
      <TextField label={t('mail.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextArea label={t('mail.message')} value={message} onChange={(e) => setMessage(e.target.value)} className="sales-mailbody" />
      <span className="sales-hint">{t('mail.foot')}</span>
      <ActionError action={send} />
    </Sheet>
  );
}
