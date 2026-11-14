'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Banner, Card, DocRow, FileText } from '@/components/ui';
import type { AgentSetup } from './types';

/**
 * For a signed-in agent: "Finish your set-up" until the agreement is signed, then "ANANDA
 * countersigns your agreement" until an Admin has. Renders nothing once the set-up is finished.
 * Exported for Home as well (agents land there after signing in).
 */
export function SetupBanner() {
  const t = useTranslations('agents');
  const { isAgent } = useSession();
  const q = useQuery({
    queryKey: ['agents', 'setup', 'me'],
    queryFn: () => api.get<AgentSetup>('/agents/me/setup'),
    enabled: isAgent,
  });
  if (!isAgent || !q.data || q.data.status === 'done') return null;
  if (q.data.status === 'countersign') {
    return (
      <Banner sub={t('setupBanner.waitingText')} action={{ label: t('setupBanner.view'), href: '/agents/setup' }}>
        {t('setupBanner.waitingTitle')}
      </Banner>
    );
  }
  return (
    <Banner sub={t('setupBanner.text')} action={{ label: t('setupBanner.action'), href: '/agents/setup' }}>
      {t('setupBanner.title')}
    </Banner>
  );
}

/** "Agreement and invoices" on the agent's Earnings once the agreement is signed. */
export function AgreementRow() {
  const t = useTranslations('agents');
  const { date } = useFmt();
  const q = useQuery({
    queryKey: ['agents', 'setup', 'me'],
    queryFn: () => api.get<AgentSetup>('/agents/me/setup'),
  });
  const a = q.data?.agreement;
  if (!q.data || !a?.signedAt) return null;
  return (
    <Card title={t('setup.agreementCard.title')}>
      <DocRow
        icon={FileText}
        title={t('setup.agreementCard.line', { v: a.version })}
        sub={
          a.countersignedAt
            ? t('setup.agreementCard.both', {
                date: date(a.signedAt),
                counter: date(a.countersignedAt),
              })
            : t('setup.agreementCard.signed', { date: date(a.signedAt) })
        }
        actions={
          <a className="an-btn secondary sm keep" href={`/api/agents/${q.data.agent.id}/agreement`} target="_blank" rel="noreferrer">
            {t('setup.contract.read')}
          </a>
        }
      />
    </Card>
  );
}
