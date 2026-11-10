'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { Banner, Button, Segmented, TextArea } from '@/components/ui';

/**
 * Message-only draft for the invitation (the subject, greeting and sign-up link are added by the
 * invitation e-mail itself), with the same tone choices and AI polishing as EmailDraft.
 */
export function MessageDraft({ label, help, value, onChange, language }: { label: string; help?: string; value: string; onChange: (v: string) => void; language: string }) {
  const tc = useTranslations('common');
  const locale = useLocale();
  const [tone, setTone] = useState<'friendly' | 'neutral' | 'firm'>('friendly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/ai/status'), staleTime: Infinity });

  async function polish() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ text: string }>('/ai/polish', { text: value, tone, language: language || locale });
      onChange(r.text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <TextArea label={label} help={help} value={value} onChange={(e) => onChange(e.target.value)} rows={8} />
      {ai.data?.enabled && (
        <div className="row wrap">
          <Segmented label={tc('tone')} value={tone} onChange={setTone} options={(['friendly', 'neutral', 'firm'] as const).map((v) => ({ value: v, label: tc(`tones.${v}`) }))} />
          <Button size="sm" onClick={polish} busy={busy} disabled={!value.trim()}>
            {busy ? tc('polishing') : tc('polish')}
          </Button>
        </div>
      )}
      {error && <Banner tone="bad">{error}</Banner>}
    </div>
  );
}
