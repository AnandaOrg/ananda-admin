import { formatUnitPrice, type BusinessRules, type CompanyProfile } from '@ananda/shared';

export type AgreementLang = 'en' | 'bg' | 'he';

export interface AgreementParty {
  companyName: string;
  vatNumber: string;
  address: string;
  person: string;
}

/** Frozen into documents.data when the broker signs; the countersigned version adds the Admin's signature. */
export interface AgreementSnapshot {
  version: number;
  language: AgreementLang;
  title: string;
  clauses: string[];
  principal: AgreementParty;
  broker: AgreementParty & { email: string };
  bank: { bankName: string; iban: string; bic: string; accountHolder: string };
  terms: { commissionPerUnitCents: number; ownershipMonths: number };
  brokerSignature: { name: string; at: string; ip: string | null; method?: 'app' | 'paper'; scanDocumentId?: string | null };
  adminSignature?: { name: string; at: string; userId: string };
}

export const AGREEMENT_VERSION = 1;

/**
 * The broker agreement shown to the broker before signing (version 1). The wording states the
 * commercial terms the app enforces: commission per unit plus VAT, payable once the customer has
 * paid in full, and customer ownership counted from each order. Legal text to be reviewed by the
 * company's lawyer; a new version gets a new AGREEMENT_VERSION.
 */
export function agreementText(lang: AgreementLang, company: CompanyProfile, rules: BusinessRules): { title: string; clauses: string[] } {
  const perUnit = formatUnitPrice(rules.commissionPerUnitCents, lang === 'bg' ? 'bg' : 'en');
  const months = rules.ownership.months;
  const name = company.legalName || company.name;
  if (lang === 'bg') {
    return {
      title: 'Брокерски договор',
      clauses: [
        `1. Предмет. Брокерът представя продуктите на ${name} (Aloha, Gaia, Santorini и Kyoto) пред бизнес клиенти и изпраща поръчки чрез приложението ANANDA.`,
        `2. Комисионна. За всяка продадена бройка брокерът получава ${perUnit} плюс ДДС. Комисионната става готова за плащане, след като клиентът плати поръчката изцяло.`,
        '3. Плащане. Брокерът издава фактура към дружеството за готовата комисионна. Плащането е по банковата сметка, посочена от брокера в приложението.',
        `4. Клиенти. Клиентът остава на брокера ${months} месеца от всяка поръчка. Новите клиенти се одобряват от администратор.`,
        '5. Цени. Брокерът продава по ценовата листа в приложението. Специални цени и корекции се одобряват от администратор.',
        '6. Поверителност. Брокерът пази поверителни цените, клиентите и търговската информация на дружеството, и след края на договора.',
        '7. Срок. Договорът е безсрочен. Всяка страна може да го прекрати с 30 дни писмено предизвестие. Комисионната за изцяло платени поръчки се изплаща и след прекратяването.',
        '8. Подписване. Страните подписват договора с електронен подпис в приложението ANANDA. Договорът влиза в сила, когато и двете страни са подписали.',
      ],
    };
  }
  if (lang === 'he') {
    return {
      title: 'הסכם ברוקר',
      clauses: [
        `1. מטרה. הברוקר מציג את מוצרי ${name} (Aloha, Gaia, Santorini ו-Kyoto) ללקוחות עסקיים ושולח הזמנות דרך אפליקציית ANANDA.`,
        `2. עמלה. על כל יחידה שנמכרה הברוקר מקבל ${perUnit} בתוספת מע"מ. העמלה מוכנה לתשלום לאחר שהלקוח שילם את ההזמנה במלואה.`,
        '3. תשלום. הברוקר מוציא חשבונית לחברה על העמלה המוכנה. התשלום מתבצע לחשבון הבנק שהברוקר מסר באפליקציה.',
        `4. לקוחות. לקוח נשאר אצל הברוקר ${months} חודשים מכל הזמנה. לקוחות חדשים מאושרים על ידי מנהל.`,
        '5. מחירים. הברוקר מוכר לפי המחירון באפליקציה. מחירים מיוחדים ותיקונים מאושרים על ידי מנהל.',
        '6. סודיות. הברוקר שומר בסוד את המחירים, הלקוחות והמידע העסקי של החברה, גם לאחר סיום ההסכם.',
        '7. תקופה. ההסכם אינו מוגבל בזמן. כל צד רשאי לסיים אותו בהודעה בכתב של 30 יום. עמלה על הזמנות ששולמו במלואן משולמת גם לאחר הסיום.',
        '8. חתימה. הצדדים חותמים על ההסכם בחתימה אלקטרונית באפליקציית ANANDA. ההסכם נכנס לתוקף כאשר שני הצדדים חתמו.',
      ],
    };
  }
  return {
    title: 'Broker agreement',
    clauses: [
      `1. Purpose. The broker presents ${name}'s products (Aloha, Gaia, Santorini and Kyoto) to business customers and sends orders through the ANANDA app.`,
      `2. Commission. The broker earns ${perUnit} a unit sold, plus VAT. Commission is ready to pay once the customer has paid the order in full.`,
      '3. Payment. The broker invoices the company for commission that is ready to pay. It is paid into the bank account the broker gave in the app.',
      `4. Customers. A customer stays with the broker for ${months} months from each order. New customers are approved by an Admin.`,
      '5. Prices. The broker sells at the price list in the app. Special prices and corrections are approved by an Admin.',
      "6. Confidentiality. The broker keeps the company's prices, customers and business information confidential, also after the agreement ends.",
      '7. Term. The agreement has no end date. Either side can end it with 30 days written notice. Commission on orders paid in full is still paid after it ends.',
      '8. Signing. Both sides sign this agreement with an electronic signature in the ANANDA app. It takes effect once both have signed.',
    ],
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LABELS = {
  en: { principal: 'Company', broker: 'Broker', vat: 'VAT / EIK', bank: 'Bank account', signed: 'Signed electronically by', on: 'on', waiting: 'Waiting for ANANDA to countersign', paper: 'Signed on paper · scan uploaded' },
  bg: { principal: 'Дружество', broker: 'Брокер', vat: 'ДДС / ЕИК', bank: 'Банкова сметка', signed: 'Подписано електронно от', on: 'на', waiting: 'Очаква подпис от ANANDA', paper: 'Подписано на хартия · сканирането е качено' },
  he: { principal: 'חברה', broker: 'ברוקר', vat: 'מע"מ / ח.פ.', bank: 'חשבון בנק', signed: 'נחתם אלקטרונית על ידי', on: 'ב-', waiting: 'ממתין לחתימה של ANANDA', paper: 'נחתם על נייר · הסריקה הועלתה' },
};

/** Print-ready page of a signed agreement (paper colours only). */
export function agreementHtml(d: AgreementSnapshot): string {
  const L = LABELS[d.language] ?? LABELS.en;
  const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const party = (label: string, p: AgreementParty) => `<div><div class="m">${label}</div><b>${esc(p.companyName)}</b><div>${L.vat}: ${esc(p.vatNumber)}</div><div>${esc(p.address)}</div><div>${esc(p.person)}</div></div>`;
  return `<!doctype html><html lang="${d.language}" dir="${d.language === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(d.title)} · ${esc(d.broker.person)}</title>
<style>body{font:13px/20px system-ui,sans-serif;background:#F6F5F0;color:#1D1D1B;margin:0;padding:32px}main{max-width:720px;margin:auto}
.logo{font-weight:600;letter-spacing:.25em;font-size:14px}.m{color:#6B6A64;font-size:12px}h1{font-weight:400;font-size:24px;margin:24px 0 16px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}p{margin:0 0 12px}.sig{border-top:1px solid #D9D7CF;margin-top:24px;padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
.line{border-bottom:1px solid #1D1D1B;height:40px;margin-bottom:6px}.sig b{font-family:"Brush Script MT",cursive;font-size:22px;font-weight:400}</style></head><body><main>
<div class="logo">ANANDA</div><h1>${esc(d.title)}</h1>
<div class="parties">${party(L.principal, d.principal)}${party(L.broker, d.broker)}</div>
${d.clauses.map((c) => `<p>${esc(c)}</p>`).join('')}
<p class="m">${L.bank}: ${esc(d.bank.accountHolder)} · ${esc(d.bank.bankName)} · IBAN ${esc(d.bank.iban)} · BIC ${esc(d.bank.bic)}</p>
<div class="sig"><div><div class="m">${L.broker}</div>${d.brokerSignature.name ? `<b>${esc(d.brokerSignature.name)}</b><div class="m">${d.brokerSignature.method === 'paper' ? `${L.paper} · ${when(d.brokerSignature.at)}` : `${L.signed} ${esc(d.brokerSignature.name)} ${L.on} ${when(d.brokerSignature.at)}`}</div>` : `<div class="line"></div><div class="m">${esc(d.broker.person)}</div>`}</div>
<div><div class="m">${L.principal}</div>${d.adminSignature ? `<b>${esc(d.adminSignature.name)}</b><div class="m">${L.signed} ${esc(d.adminSignature.name)} ${L.on} ${when(d.adminSignature.at)}</div>` : `<div class="m">${L.waiting}</div>`}</div></div>
</main></body></html>`;
}
