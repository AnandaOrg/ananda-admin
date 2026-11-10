'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { Banner, Button, Segmented, TextArea, TextField } from '@/components/ui';

export interface Draft {
  subject: string;
  body: string;
}

/**
 * Pre-written e-mail the user edits before sending, with tone choices and optional AI
 * polishing (shown only when the server has it set up).
 */
export function EmailDraft({ value, onChange, to, showTone = true }: { value: Draft; onChange: (d: Draft) => void; to?: string; showTone?: boolean }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [tone, setTone] = useState<'friendly' | 'neutral' | 'firm'>('neutral');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/ai/status'), staleTime: Infinity });

  async function polish() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ text: string }>('/ai/polish', { text: value.body, tone, language: locale });
      onChange({ ...value, body: r.text });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {to && <TextField label={t('emailDraft.to')} value={to} readOnly />}
      <TextField label={t('emailDraft.subject')} value={value.subject} onChange={(e) => onChange({ ...value, subject: e.target.value })} />
      <TextArea label={t('emailDraft.message')} value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} rows={9} />
      {ai.data?.enabled && showTone && (
        <div className="row wrap">
          <Segmented
            label={t('tone')}
            value={tone}
            onChange={setTone}
            options={(['friendly', 'neutral', 'firm'] as const).map((v) => ({ value: v, label: t(`tones.${v}`) }))}
          />
          <Button size="sm" onClick={polish} busy={busy} disabled={!value.body.trim()}>
            {busy ? t('polishing') : t('polish')}
          </Button>
        </div>
      )}
      {error && <Banner tone="bad">{error}</Banner>}
    </div>
  );
}
