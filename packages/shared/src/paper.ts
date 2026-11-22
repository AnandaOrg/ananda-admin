// One document layout for every viewer (PRO-0008 style): the same paper is shown in the app's
// document panel, printed or saved as PDF, and attached to e-mails. A document is always shown in
// its own language (the customer's), whatever the viewer's language.
import { FLAVOURS, UNITS_PER_CARTON, type Flavour } from './domain';
import { formatDate, formatMoney, formatNumber, formatUnitPrice } from './format';

export type PaperLang = 'en' | 'bg' | 'he';

export interface PaperSpec {
  lang: PaperLang;
  company: { name: string; lines: string[] };
  type: string;
  no: string;
  date: string;
  ref?: string | null;
  note?: string | null;
  parties: { label: string; name: string; sub: string }[];
  cols: string[];
  rows: string[][];
  sum: { label: string; value: string; total?: boolean }[];
  sign?: { left: string; right: string } | null;
  foot?: string | null;
  /** Settings › Documents: the uploaded logo (image URL or data URI) and one footer line. */
  logo?: string | null;
  footer?: string | null;
}

export interface PaperBrand {
  logo?: string | null;
  footer?: string | null;
}

/** The parts of a customer document snapshot (documents.data) that the paper prints. */
export interface PaperDocData {
  number: string;
  issuedOn: string;
  language: string;
  company: Record<string, string>;
  bank: { bank: string; iban: string; bic: string };
  customer: { companyName: string; vatNumber: string; registeredAddress: string; deliveryAddress: string | null; contactName: string; invoiceEmail: string };
  orderNumber: string;
  lines: { flavour: Flavour; cartons: number; units: number; unitPriceCents: number; lineNetCents: number }[];
  netCents: number;
  vatCents: number;
  totalCents: number;
  dueOn?: string | null;
  validUntil?: string | null;
  references?: string | null;
  reason?: string | null;
  note?: string | null;
  replaces?: string | null;
  priceAdjustment?: boolean;
  paidCents?: number | null;
  paidOn?: string | null;
  paidMethod?: string | null;
  deliveredOn?: string | null;
  /** The customer's payment terms when the proforma was issued, and the 50% deposit asked for. */
  paymentTerms?: OrderPaymentTerms | null;
  depositCents?: number | null;
}

export type OrderPaymentTerms = 'before_shipping' | 'half_before_shipping' | 'after_delivery_30';

/** What has to be paid before an order ships under the customer's terms (30 days after delivery: nothing). */
export function dueBeforeShippingCents(terms: string | null | undefined, totalCents: number, creditedCents = 0): number {
  return terms === 'after_delivery_30' ? 0 : Math.max(0, totalCents - creditedCents);
}

/** The 50% asked for now under "50% now, 50% before shipping". */
export function depositOf(totalCents: number): number {
  return Math.ceil(totalCents / 2);
}

/** Hebrew papers run right to left: IBANs, numbers, amounts and codes are isolated so they keep their own order. */
const iso = (v: string) => `\u2068${v}\u2069`;

const LABELS = {
  en: {
    proforma: 'Proforma invoice',
    invoice: 'Commercial invoice',
    credit_note: 'Credit note',
    delivery_note: 'Delivery note',
    warehouse: 'Warehouse order',
    payment: 'Payment received',
    upload: 'Uploaded file',
    no: 'No.',
    date: 'Date',
    order: 'Order',
    item: 'Item',
    qty: 'Qty',
    price: 'Price',
    amount: 'Amount',
    cartons: 'Cartons',
    units: 'Units',
    method: 'Method',
    reference: 'Reference',
    billTo: 'Bill to',
    deliveredTo: 'Delivered to',
    deliverTo: 'Deliver to',
    pickFrom: 'Pick from',
    receivedFrom: 'Received from',
    paidInto: 'Paid into',
    net: 'Total excl. VAT',
    vat: 'VAT 20%',
    total: 'Total',
    totalCredit: 'Total credit',
    received: 'Received',
    stillToPay: 'Still to pay',
    balance: 'Balance',
    paid: 'Paid',
    vatNo: 'VAT',
    product: (f: string) => `ANANDA ${f} · 250 ml`,
    replaces: (n: string) => `Replaces ${n}`,
    replacedBy: (n: string) => `Replaced by ${n}`,
    credits: (n: string, r: string) => `Credits invoice ${n} · Reason: ${r}`,
    payTo: (iban: string, ref: string) => `Pay to ${iban} · Reference ${ref} · 100% before shipping`,
    payBy: (d: string) => `pay by ${d}`,
    payToDeposit: (iban: string, ref: string, dep: string) => `Pay to ${iban} · Reference ${ref} · 50% deposit now: ${dep}, the rest before shipping`,
    afterDelivery: 'Payment: 30 days after delivery, on the commercial invoice',
    payToInvoice: (iban: string, ref: string) => `Pay to ${iban} · Reference ${ref}`,
    validUntil: (d: string) => `valid until ${d}`,
    paidInFull: (method: string, ref: string) => `Paid in full by ${method.toLowerCase()}, reference ${ref}. Thank you.`,
    receivedBy: 'Received by: [signature]',
    nameDate: 'Name and date',
    priceAdj: 'Price adjustment, as agreed',
    creditFoot: { returned: 'Returned cartons go back into available stock.', damaged: 'Damaged cartons are written off, not returned to stock.', price: "Agreed price adjustment. Stock doesn't change." },
    reasons: { returned: 'Returned cartons', damaged: 'Damaged on delivery', price_error: 'Price adjustment', price_adjustment: 'Price adjustment', other: 'Other' } as Record<string, string>,
    methods: { bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', other: 'Other' } as Record<string, string>,
    warehouseName: 'ANANDA warehouse',
    warehouseFoot: 'Paid in full, ready to ship. No prices are sent to the warehouse.',
    paymentFoot: (who: string, d: string) => `Confirmed by ${who} on ${d}.`,
    proformaN: (n: string) => `Proforma ${n}`,
    customerBank: "[Customer's bank account]",
  },
  bg: {
    proforma: 'Проформа фактура',
    invoice: 'Търговска фактура',
    credit_note: 'Кредитно известие',
    delivery_note: 'Стокова разписка',
    warehouse: 'Складова поръчка',
    payment: 'Плащането е получено',
    upload: 'Качен файл',
    no: '№',
    date: 'Дата',
    order: 'Поръчка',
    item: 'Артикул',
    qty: 'Кол.',
    price: 'Цена',
    amount: 'Сума',
    cartons: 'Кашони',
    units: 'Броя',
    method: 'Метод',
    reference: 'Референция',
    billTo: 'Фактурирай на',
    deliveredTo: 'Доставено до',
    deliverTo: 'Доставка до',
    pickFrom: 'Вземи от',
    receivedFrom: 'Получено от',
    paidInto: 'Платено по сметка',
    net: 'Общо без ДДС',
    vat: 'ДДС 20%',
    total: 'Общо',
    totalCredit: 'Общ кредит',
    received: 'Получено',
    stillToPay: 'Остава за плащане',
    balance: 'Салдо',
    paid: 'Платено',
    vatNo: 'ДДС №',
    product: (f: string) => `ANANDA ${f} · 250 ml`,
    replaces: (n: string) => `Заменя ${n}`,
    replacedBy: (n: string) => `Заменена с ${n}`,
    credits: (n: string, r: string) => `Кредитира фактура ${n} · Причина: ${r}`,
    payTo: (iban: string, ref: string) => `Платете по ${iban} · Основание ${ref} · 100% преди изпращане`,
    payBy: (d: string) => `плащане до ${d}`,
    payToDeposit: (iban: string, ref: string, dep: string) => `Платете по ${iban} · Основание ${ref} · 50% аванс сега: ${dep}, остатъкът преди изпращане`,
    afterDelivery: 'Плащане: 30 дни след доставка, по търговската фактура',
    payToInvoice: (iban: string, ref: string) => `Платете по ${iban} · Основание ${ref}`,
    validUntil: (d: string) => `валидна до ${d}`,
    paidInFull: (method: string, ref: string) => `Изцяло платено (${method.toLowerCase()}), основание ${ref}. Благодарим Ви.`,
    receivedBy: 'Получил: [подпис]',
    nameDate: 'Име и дата',
    priceAdj: 'Корекция на цената, по договорка',
    creditFoot: { returned: 'Върнатите кашони се връщат в наличността.', damaged: 'Повредените кашони се отписват, не се връщат в наличност.', price: 'Договорена корекция на цената. Наличността не се променя.' },
    reasons: { returned: 'Върнати кашони', damaged: 'Повредено при доставка', price_error: 'Корекция на цената', price_adjustment: 'Корекция на цената', other: 'Друго' } as Record<string, string>,
    methods: { bank_transfer: 'Банков превод', cash: 'В брой', card: 'Карта', other: 'Друго' } as Record<string, string>,
    warehouseName: 'Склад ANANDA',
    warehouseFoot: 'Изцяло платено, готово за изпращане. Цените не се изпращат на склада.',
    paymentFoot: (who: string, d: string) => `Потвърдено от ${who} на ${d}.`,
    proformaN: (n: string) => `Проформа ${n}`,
    customerBank: '[Сметка на клиента]',
  },
  he: {
    proforma: 'חשבון עסקה',
    invoice: 'חשבונית מסחרית',
    credit_note: 'הודעת זיכוי',
    delivery_note: 'תעודת משלוח',
    warehouse: 'הזמנת מחסן',
    payment: 'התשלום התקבל',
    upload: 'קובץ שהועלה',
    no: 'מס׳',
    date: 'תאריך',
    order: 'הזמנה',
    item: 'פריט',
    qty: 'כמות',
    price: 'מחיר',
    amount: 'סכום',
    cartons: 'קרטונים',
    units: 'יחידות',
    method: 'אמצעי תשלום',
    reference: 'אסמכתא',
    billTo: 'לכבוד',
    deliveredTo: 'נמסר אל',
    deliverTo: 'משלוח אל',
    pickFrom: 'איסוף מ',
    receivedFrom: 'התקבל מ',
    paidInto: 'שולם לחשבון',
    net: 'סה״כ לפני מע״מ',
    vat: 'מע״מ 20%',
    total: 'סה״כ',
    totalCredit: 'סה״כ זיכוי',
    received: 'התקבל',
    stillToPay: 'נותר לתשלום',
    balance: 'יתרה',
    paid: 'שולם',
    vatNo: 'מס׳ מע״מ',
    product: (f: string) => iso(`ANANDA ${f} · 250 ml`),
    replaces: (n: string) => `מחליפה את ${iso(n)}`,
    replacedBy: (n: string) => `הוחלפה ב־${iso(n)}`,
    credits: (n: string, r: string) => `זיכוי לחשבונית ${iso(n)} · סיבה: ${r}`,
    payTo: (iban: string, ref: string) => `לתשלום לחשבון ${iso(iban)} · אסמכתא ${iso(ref)} · 100% לפני המשלוח`,
    payBy: (d: string) => `לתשלום עד ${d}`,
    payToDeposit: (iban: string, ref: string, dep: string) => `לתשלום לחשבון ${iso(iban)} · אסמכתא ${iso(ref)} · מקדמה של 50% עכשיו: ${iso(dep)}, היתרה לפני המשלוח`,
    afterDelivery: 'תשלום: 30 יום לאחר אספקה, לפי החשבונית המסחרית',
    payToInvoice: (iban: string, ref: string) => `לתשלום לחשבון ${iso(iban)} · אסמכתא ${iso(ref)}`,
    validUntil: (d: string) => `בתוקף עד ${d}`,
    paidInFull: (method: string, ref: string) => `שולם במלואו (${method}), אסמכתא ${iso(ref)}. תודה רבה.`,
    receivedBy: 'התקבל על ידי: [חתימה]',
    nameDate: 'שם ותאריך',
    priceAdj: 'תיקון מחיר, כמוסכם',
    creditFoot: { returned: 'הקרטונים שהוחזרו חוזרים למלאי הזמין.', damaged: 'קרטונים פגומים נמחקים מהמלאי ולא חוזרים אליו.', price: 'תיקון מחיר מוסכם. המלאי לא משתנה.' },
    reasons: { returned: 'קרטונים שהוחזרו', damaged: 'נפגם במשלוח', price_error: 'תיקון מחיר', price_adjustment: 'תיקון מחיר', other: 'אחר' } as Record<string, string>,
    methods: { bank_transfer: 'העברה בנקאית', cash: 'מזומן', card: 'כרטיס אשראי', other: 'אחר' } as Record<string, string>,
    warehouseName: 'מחסן ANANDA',
    warehouseFoot: 'שולם במלואו, מוכן למשלוח. המחירים לא נשלחים למחסן.',
    paymentFoot: (who: string, d: string) => `אושר על ידי ${who} ב־${d}.`,
    proformaN: (n: string) => `חשבון עסקה ${iso(n)}`,
    customerBank: '[חשבון הבנק של הלקוח]',
  },
};

export function paperLang(l: string | null | undefined): PaperLang {
  return l === 'bg' || l === 'he' ? l : 'en';
}

export function paperLabels(lang: string) {
  return LABELS[paperLang(lang)];
}

const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

/** Wraps a left-to-right value (number, IBAN, address in Latin or Cyrillic) on a Hebrew paper; unchanged otherwise. */
const ltrOn = (lang: PaperLang) => (v: string | null | undefined) => (lang === 'he' && v ? iso(v) : (v ?? ''));

function companyOf(d: { company: Record<string, string> }, lang: PaperLang = 'en') {
  const c = d.company ?? {};
  const x = ltrOn(lang);
  const vat = lang === 'he' ? `${LABELS.he.vatNo} ${x(c.vatNumber)}` : `VAT ${c.vatNumber}`;
  return { name: c.name || 'ANANDA', lines: [x([c.name, c.address].filter(Boolean).join(' · ')), c.vatNumber ? vat : ''].filter(Boolean) };
}

function priceRows(lines: PaperDocData['lines'], lang: PaperLang, neg = false) {
  const L = LABELS[lang];
  const m = neg ? '−' : '';
  return FLAVOURS.flatMap((f) => lines.filter((l) => l.flavour === f)).map((l) => [L.product(cap(l.flavour)), formatNumber(l.units, lang), m + formatUnitPrice(l.unitPriceCents, lang), m + formatMoney(l.lineNetCents, lang)]);
}

function vatSum(d: { netCents: number; vatCents: number; totalCents: number }, lang: PaperLang, neg = false, totalLabel?: string) {
  const L = LABELS[lang];
  const m = neg ? '−' : '';
  return [
    { label: L.net, value: m + formatMoney(Math.abs(d.netCents), lang) },
    { label: L.vat, value: m + formatMoney(Math.abs(d.vatCents), lang) },
    { label: totalLabel ?? L.total, value: m + formatMoney(Math.abs(d.totalCents), lang), total: true },
  ];
}

/** Proforma, commercial invoice or credit note, from the frozen snapshot in documents.data. */
export function customerPaper(type: 'proforma' | 'invoice' | 'credit_note', d: PaperDocData, extra: { replacedBy?: string | null } & PaperBrand = {}): PaperSpec {
  return { ...customerPaperBody(type, d, extra), logo: extra.logo ?? null, footer: extra.footer ?? null };
}

function customerPaperBody(type: 'proforma' | 'invoice' | 'credit_note', d: PaperDocData, extra: { replacedBy?: string | null }): PaperSpec {
  const lang = paperLang(d.language);
  const L = LABELS[lang];
  const x = ltrOn(lang);
  const bill = { label: L.billTo, name: d.customer.companyName, sub: [x(d.customer.registeredAddress), d.customer.vatNumber && `${L.vatNo} ${x(d.customer.vatNumber)}`].filter(Boolean).join(' · ') };
  const base = { lang, company: companyOf(d, lang), no: d.number, date: formatDate(d.issuedOn, lang), ref: `${L.order} ${x(d.orderNumber)}`, cols: [L.item, L.qty, L.price, L.amount] };
  if (type === 'proforma') {
    const note = extra.replacedBy ? L.replacedBy(extra.replacedBy) : d.replaces ? L.replaces(d.replaces) : null;
    const iban = d.bank?.iban || '[IBAN]';
    const foot =
      d.paymentTerms === 'after_delivery_30'
        ? [L.afterDelivery, d.validUntil && L.validUntil(formatDate(d.validUntil, lang))].filter(Boolean).join(' · ')
        : [d.paymentTerms === 'half_before_shipping' ? L.payToDeposit(iban, d.orderNumber, formatMoney(d.depositCents ?? depositOf(d.totalCents), lang)) : L.payTo(iban, d.orderNumber), d.dueOn && L.payBy(formatDate(d.dueOn, lang)), d.validUntil && L.validUntil(formatDate(d.validUntil, lang))].filter(Boolean).join(' · ');
    return { ...base, type: L.proforma, note, parties: [bill], rows: priceRows(d.lines, lang), sum: vatSum(d, lang), foot };
  }
  if (type === 'invoice') {
    const parties = [bill, { label: L.deliveredTo, name: d.customer.companyName, sub: [x(d.customer.deliveryAddress || d.customer.registeredAddress), d.deliveredOn && formatDate(d.deliveredOn, lang)].filter(Boolean).join(' · ') }];
    const sum = vatSum(d, lang);
    if (d.paidCents != null) {
      sum.push({ label: d.paidOn ? `${L.paid} ${formatDate(d.paidOn, lang)}` : L.paid, value: '−' + formatMoney(d.paidCents, lang) });
      sum.push({ label: L.balance, value: formatMoney(Math.max(0, d.totalCents - d.paidCents), lang) });
    }
    const foot = d.paidCents != null && d.paidCents >= d.totalCents ? L.paidInFull(L.methods[d.paidMethod ?? 'bank_transfer'] ?? L.methods.bank_transfer, d.orderNumber) : [L.payToInvoice(d.bank?.iban || '[IBAN]', d.orderNumber), d.dueOn && L.payBy(formatDate(d.dueOn, lang))].filter(Boolean).join(' · ');
    return { ...base, type: L.invoice, ref: [base.ref, d.references && L.proformaN(d.references)].filter(Boolean).join(' · '), parties, rows: priceRows(d.lines, lang), sum, foot };
  }
  const reason = L.reasons[d.reason ?? ''] ?? d.reason ?? '';
  const rows = d.priceAdjustment || !d.lines.length ? [[L.priceAdj, '1', '−' + formatMoney(d.netCents, lang), '−' + formatMoney(d.netCents, lang)]] : priceRows(d.lines, lang, true);
  const foot = d.priceAdjustment ? L.creditFoot.price : d.reason === 'damaged' ? L.creditFoot.damaged : L.creditFoot.returned;
  return { ...base, type: L.credit_note, note: [L.credits(d.references ?? '', reason), d.note].filter(Boolean).join(' · '), parties: [bill], rows, sum: vatSum(d, lang, true, L.totalCredit), foot };
}

/** What the warehouse gets: no prices. */
export function warehousePaper(o: PaperBrand & { lang: string; company: Record<string, string>; orderNumber: string; date: string; customerName: string; address: string; contact: string; lines: { flavour: Flavour; cartons: number }[] }): PaperSpec {
  const lang = paperLang(o.lang);
  const L = LABELS[lang];
  const lines = FLAVOURS.flatMap((f) => o.lines.filter((l) => l.flavour === f && l.cartons > 0));
  const cartons = lines.reduce((s, l) => s + l.cartons, 0);
  const x = ltrOn(lang);
  return {
    lang,
    company: companyOf(o, lang),
    type: L.warehouse,
    no: o.orderNumber.replace(/^S-/, 'WO-'),
    date: formatDate(o.date, lang),
    ref: `${L.order} ${x(o.orderNumber)}`,
    parties: [
      { label: L.deliverTo, name: o.customerName, sub: [x(o.address), x(o.contact)].filter(Boolean).join(' · ') },
      { label: L.pickFrom, name: L.warehouseName, sub: '' },
    ],
    cols: [L.item, L.cartons, L.units],
    rows: lines.map((l) => [L.product(cap(l.flavour)), formatNumber(l.cartons, lang), formatNumber(l.cartons * UNITS_PER_CARTON, lang)]),
    sum: [{ label: L.total, value: `${formatNumber(cartons, lang)} · ${formatNumber(cartons * UNITS_PER_CARTON, lang)}`, total: true }],
    foot: L.warehouseFoot,
    logo: o.logo ?? null,
    footer: o.footer ?? null,
  };
}

/** Receipt for a confirmed payment. */
export function paymentPaper(p: PaperBrand & {
  lang: string;
  company: Record<string, string>;
  bank: { bank: string; iban: string };
  no: string;
  orderNumber: string;
  receivedOn: string;
  customerName: string;
  proforma: string | null;
  method: string;
  reference: string | null;
  amountCents: number;
  stillToPayCents: number;
  confirmedBy: string;
}): PaperSpec {
  const lang = paperLang(p.lang);
  const L = LABELS[lang];
  const x = ltrOn(lang);
  return {
    lang,
    company: companyOf(p, lang),
    type: L.payment,
    no: p.no,
    date: formatDate(p.receivedOn, lang),
    ref: `${L.order} ${x(p.orderNumber)}`,
    parties: [
      { label: L.receivedFrom, name: p.customerName, sub: L.customerBank },
      { label: L.paidInto, name: p.company.name || 'ANANDA', sub: [x(p.bank.bank), x(p.bank.iban)].filter(Boolean).join(' · ') },
    ],
    cols: [L.item, L.method, L.reference, L.amount],
    rows: [[p.proforma ? L.proformaN(p.proforma) : `${L.order} ${x(p.orderNumber)}`, L.methods[p.method] ?? p.method, p.reference || '—', formatMoney(p.amountCents, lang)]],
    sum: [
      { label: L.received, value: formatMoney(p.amountCents, lang), total: true },
      { label: L.stillToPay, value: formatMoney(Math.max(0, p.stillToPayCents), lang) },
    ],
    foot: L.paymentFoot(p.confirmedBy, formatDate(p.receivedOn, lang)),
    logo: p.logo ?? null,
    footer: p.footer ?? null,
  };
}

/** Paper colours only (documents never follow the app theme); var() picks up the app's tokens when present. */
export const PAPER_CSS = `.pp{direction:ltr;text-align:left;background:var(--paper-bg,#F6F5F0);color:var(--paper-ink,#1D1D1B);border-radius:12px;padding:16px;display:grid;gap:16px;font:400 12px/1.45 var(--font-sans,system-ui,sans-serif);box-shadow:var(--shadow-paper,none)}
.pp .pp-h{display:flex;justify-content:space-between;gap:12px}.pp .pp-h span{display:block;color:var(--paper-muted,#6B6A64);font-size:12px}
.pp .pp-logo{font-size:15px;letter-spacing:3px;font-weight:600}.pp .pp-t{text-align:right}.pp .pp-t b{font-size:13px;font-weight:600}
.pp .pp-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.pp .pp-bill{display:grid;gap:1px;padding:8px 12px;background:var(--paper-panel,#ECEBE4);border-radius:8px}.pp .pp-bill span{color:var(--paper-muted,#6B6A64);font-size:12px}.pp .pp-bill b{font-weight:600}
.pp table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.pp th{text-align:right;font-weight:500;color:var(--paper-muted,#6B6A64);font-size:12px;padding:0 0 8px;border-bottom:1px solid var(--paper-line,#D8D6CC)}
.pp td{text-align:right;padding:8px 0;border-bottom:1px solid var(--paper-line,#D8D6CC);white-space:nowrap}.pp th:first-child,.pp td:first-child{text-align:left;white-space:normal;padding-right:8px}.pp td+td,.pp th+th{padding-left:8px}
.pp .pp-sum{display:grid;gap:4px;font-variant-numeric:tabular-nums}.pp .pp-sum div{display:flex;justify-content:space-between;gap:8px}
.pp .pp-sum .t{font-weight:600;font-size:14px;border-top:1px solid var(--paper-ink,#1D1D1B);padding-top:8px;margin-top:2px}
.pp .pp-note{background:var(--paper-note-bg,#FBECCB);color:var(--paper-note-ink,#6B4A00);border-radius:6px;padding:8px;font-weight:500}
.pp .pp-sign{display:flex;justify-content:space-between;gap:8px;border-top:1px dashed var(--paper-muted,#6B6A64);padding-top:8px;margin-top:8px;font-style:italic}
.pp .pp-f{color:var(--paper-muted,#6B6A64);font-size:12px;border-top:1px solid var(--paper-line,#D8D6CC);padding-top:8px}
.pp .pp-up{display:grid;justify-items:center;text-align:center;gap:8px;padding:24px 8px;background:var(--paper-panel,#ECEBE4);border-radius:8px}.pp .pp-up span{color:var(--paper-muted,#6B6A64)}.pp .pp-up b{word-break:break-all}
.pp .pp-up img{max-width:100%;max-height:420px;border-radius:6px}
.pp .pp-logoimg{display:block;max-height:40px;max-width:180px;object-fit:contain;margin-bottom:4px}.pp .pp-cf{color:var(--paper-muted,#6B6A64);font-size:11px;text-align:center}
.pp[dir=rtl]{direction:rtl;text-align:right}.pp[dir=rtl] .pp-t{text-align:left}.pp[dir=rtl] th,.pp[dir=rtl] td{text-align:left}
.pp[dir=rtl] th:first-child,.pp[dir=rtl] td:first-child{text-align:right;padding-right:0;padding-left:8px}.pp[dir=rtl] td+td,.pp[dir=rtl] th+th{padding-left:0;padding-right:8px}`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The paper as HTML (inner markup of the .pp element's parent). Every value is escaped. */
export function paperHtml(d: PaperSpec): string {
  const L = LABELS[paperLang(d.lang)];
  const rtl = d.lang === 'he';
  // Hebrew: numbers, amounts and codes sit in their own isolate so a minus or € stays in place.
  const v = (s: unknown) => (rtl ? `<bdi>${esc(s)}</bdi>` : esc(s));
  return `<div class="pp" lang="${d.lang}"${rtl ? ' dir="rtl"' : ''}>
<div class="pp-h"><div>${d.logo ? `<img class="pp-logoimg" src="${esc(d.logo)}" alt="${esc(d.company.name)}">` : '<b class="pp-logo">ANANDA</b>'}${d.company.lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div><div class="pp-t"><b>${esc(d.type)}</b><span>${esc(L.no)} ${v(d.no)}</span><span>${esc(L.date)} ${esc(d.date)}</span>${d.ref ? `<span>${esc(d.ref)}</span>` : ''}</div></div>
${d.note ? `<div class="pp-note">${esc(d.note)}</div>` : ''}
<div class="pp-parties">${d.parties.map((p) => `<div class="pp-bill"><span>${esc(p.label)}</span><b>${esc(p.name)}</b>${p.sub ? `<span>${esc(p.sub)}</span>` : ''}</div>`).join('')}</div>
<table><thead><tr>${d.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r) => `<tr>${r.map((c, i) => `<td>${i ? v(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="pp-sum">${d.sum.map((s) => `<div${s.total ? ' class="t"' : ''}><span>${esc(s.label)}</span><span>${v(s.value)}</span></div>`).join('')}</div>
${d.sign ? `<div class="pp-sign"><span>${esc(d.sign.left)}</span><span>${esc(d.sign.right)}</span></div>` : ''}
${d.foot ? `<div class="pp-f">${esc(d.foot)}</div>` : ''}
${d.footer ? `<div class="pp-cf">${esc(d.footer)}</div>` : ''}
</div>`;
}

/** A full printable page: used for Download PDF (print) and as the e-mail attachment. */
export function paperPage(d: PaperSpec, opts: { title: string; autoPrint?: boolean }): string {
  return `<!doctype html><html lang="${d.lang}"${d.lang === 'he' ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title>
<style>body{margin:0;padding:32px 16px;background:#E9E8E2}main{max-width:720px;margin:auto}${PAPER_CSS}@media print{body{background:#fff;padding:0}.pp{box-shadow:none}}</style></head>
<body><main>${paperHtml(d)}</main>${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},200)})</script>' : ''}</body></html>`;
}

/** What a broker can upload to their own order (10 Nov feedback). A proof of payment never confirms the payment. */
export const ORDER_UPLOAD_KINDS = ['purchase_order', 'signed_order', 'payment_proof', 'delivery', 'other'] as const;
export type OrderUploadKind = (typeof ORDER_UPLOAD_KINDS)[number];
export const ORDER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
