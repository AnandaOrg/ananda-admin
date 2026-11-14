'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { Banner, Button, Pill } from '@/components/ui';
import s from '../brokers.module.css';

export type Tone = 'friendly' | 'short' | 'formal';

/**
 * Pre-written text with "Polish with AI" (prototype: label row button, Friendlier / Shorter / More
 * formal, Polished + Undo). The AI rewrite is shown in place for the user to review before sending.
 */
export function PolishableText({ label, value, onChange, subject, rows = 7, language }: { label: string; value: string; onChange: (v: string) => void; subject?: string; rows?: number; language?: string }) {
  const t = useTranslations('brokers');
  const locale = useLocale();
  const [tone, setTone] = useState<Tone>('friendly');
  const [orig, setOrig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/ai/status'), staleTime: Infinity });
  const enabled = !!ai.data?.enabled;

  async function polish(nextTone = tone) {
    setBusy(true);
    setError(null);
    try {
      const base = orig ?? value;
      const r = await api.post<{ text: string }>('/ai/polish', { text: base, tone: nextTone, language: language || locale });
      setOrig(base);
      onChange(r.text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const undo = () => {
    if (orig !== null) onChange(orig);
    setOrig(null);
  };
  const pickTone = (v: Tone) => {
    setTone(v);
    if (orig !== null && enabled) polish(v);
  };

  return (
    <div className="an-field">
      <div className={s.draftHead}>
        <label>{label}</label>
        {orig !== null && (
          <>
            <Pill tone="info">{t('mail.polished')}</Pill>
            <button type="button" className="link body-sm" onClick={undo}>
              {t('mail.undo')}
            </button>
          </>
        )}
        <Button size="sm" className={s.polishBtn} busy={busy} disabled={!enabled || !value.trim()} title={enabled ? undefined : t('mail.aiOff')} onClick={() => polish()}>
          ✦ {orig !== null ? t('mail.polishAgain') : t('mail.polish')}
        </Button>
      </div>
      {subject !== undefined ? (
        <div className={`${s.draft} ${orig !== null ? s.polished : ''}`}>
          <span className={s.subjLine}>{t('inviteSheet.subjectLine', { subject })}</span>
          <textarea aria-label={label} className={s.draftArea} style={{ border: 0, padding: 0, minHeight: rows * 20, background: 'transparent' }} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
        </div>
      ) : (
        <textarea aria-label={label} className={`${s.draftArea} ${orig !== null ? s.polished : ''}`} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
      )}
      <div className={s.tones} role="group" aria-label={label}>
        {(['friendly', 'short', 'formal'] as const).map((v) => (
          <button key={v} type="button" className={s.tone} aria-pressed={tone === v} onClick={() => pickTone(v)}>
            {t(`mail.tones.${v}`)}
          </button>
        ))}
      </div>
      {error && <Banner tone="bad">{error}</Banner>}
    </div>
  );
}
