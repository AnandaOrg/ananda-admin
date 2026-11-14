/** IBAN check digits (ISO 13616, mod 97); the API checks the same. */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** IBAN in groups of four for reading. */
export const groupIban = (iban: string) => iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

/** Bulgarian banks by the bank code in the IBAN (characters 5–8): BIC and name. */
const BG_BANKS: Record<string, [string, string]> = {
  BNBG: ['BNBGBGSD', 'Bulgarian National Bank'],
  UNCR: ['UNCRBGSF', 'UniCredit Bulbank'],
  STSA: ['STSABGSF', 'DSK Bank'],
  FINV: ['FINVBGSF', 'Fibank'],
  BPBI: ['BPBIBGSF', 'Postbank'],
  UBBS: ['UBBSBGSF', 'UBB'],
  RZBB: ['RZBBBGSF', 'UBB (formerly Raiffeisenbank)'],
  CECB: ['CECBBGSF', 'Central Cooperative Bank'],
  BGUS: ['BGUSBGSF', 'BACB'],
  PRCB: ['PRCBBGSF', 'ProCredit Bank'],
  IORT: ['IORTBGSF', 'Investbank'],
  BUIN: ['BUINBGSF', 'Allianz Bank Bulgaria'],
  TTBB: ['TTBBBG22', 'Texim Bank'],
  TBIB: ['TBIBBGSF', 'TBI Bank'],
  DEMI: ['DEMIBGSF', 'D Commerce Bank'],
  CREX: ['CREXBGSF', 'Tokuda Bank'],
  IABG: ['IABGBGSF', 'International Asset Bank'],
  BINV: ['BINVBGSF', 'Bulgarian Development Bank'],
  SOMB: ['SOMBBGSF', 'Municipal Bank'],
};

export function bankFromIban(raw: string): { bic: string; name: string } | null {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!iban.startsWith('BG') || iban.length < 8) return null;
  const hit = BG_BANKS[iban.slice(4, 8)];
  return hit ? { bic: hit[0], name: hit[1] } : null;
}
