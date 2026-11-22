'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button } from './controls';
import { TwoStepField } from './fields';
import { Banner } from './layout';
import { ActionError } from './states';
import { Icon, ShieldCheck } from './icon';

/** The server refused the code (wrong, expired or missing), as opposed to a problem with the form. */
export const isStepUpError = (e: unknown) => e instanceof ApiError && !!e.code?.startsWith('step_up');

type Action = { error: ApiError | null; isPending: boolean; retry: () => void };

/**
 * Two steps for every action that needs a fresh two-step code (confirm payment, pay commission,
 * supplier payment, rule changes): first the person confirms the form, then enters the code to finish.
 * A wrong code keeps them on the code; any other error takes them back to the form, where it shows.
 */
export function useStepUp(action: Action) {
  const [stage, setStage] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const seen = useRef<ApiError | null>(null);
  useEffect(() => {
    const e = action.error;
    if (!e || e === seen.current) return;
    seen.current = e;
    if (isStepUpError(e)) setCode('');
    else setStage('form');
  }, [action.error]);
  const reset = useCallback(() => {
    setStage('form');
    setCode('');
  }, []);
  return {
    stage,
    onCode: stage === 'code',
    code,
    setCode,
    ready: code.length === 6,
    /** Stage 1 → 2: the form is confirmed, now ask for the code. */
    ask: () => {
      setCode('');
      setStage('code');
    },
    back: reset,
    reset,
    /** The code error, for the code field (only on stage 2). */
    codeError: isStepUpError(action.error) ? action.error!.message : undefined,
    /** Errors that belong to the form (stage 1): not the code ones. */
    formError: action.error && !isStepUpError(action.error) ? action.error : null,
    action,
  };
}

export type StepUp = ReturnType<typeof useStepUp>;

/**
 * Stage 2: what is being confirmed, the code field and, when the person has no authenticator app yet,
 * a plain note instead of a code that can't work. Put `StepUpButtons` in the footer.
 */
export function CodeStep({ step, summary }: { step: StepUp; summary?: ReactNode }) {
  const t = useTranslations('common');
  const { me } = useSession();
  const noApp = !me.user.twoStepEnabled;
  return (
    <div className="stack step-up">
      {summary}
      <div className="step-up-h">
        <span className="step-up-ic" aria-hidden>
          <Icon as={ShieldCheck} />
        </span>
        <span className="grow">
          <b>{t('twoStep.stepTitle')}</b>
          <span className="sub">{t('twoStep.stepText')}</span>
        </span>
      </div>
      {noApp ? (
        <Banner tone="bad" sub={t('twoStep.noAppText')} action={{ label: t('twoStep.noAppAction'), href: '/profile' }}>
          {t('twoStep.noApp')}
        </Banner>
      ) : (
        <TwoStepField value={step.code} onChange={step.setCode} error={step.codeError} autoFocus />
      )}
      {step.action.error && !step.codeError && <ActionError action={step.action} />}
    </div>
  );
}

/** Stage 1: the form's own verb (moves on to the code). Stage 2: Back + the same verb, which finishes it. */
export function StepUpButtons({
  step,
  label,
  icon,
  disabled,
  busy,
  onConfirm,
  onSubmit,
  block,
  secondary,
}: {
  step: StepUp;
  label: ReactNode;
  icon?: Parameters<typeof Button>[0]['icon'];
  /** Stage 1: the form isn't ready yet. */
  disabled?: boolean;
  /** Stage 1: busy when it saves straight away (no code needed this time). */
  busy?: boolean;
  /** Stage 1 click: check the form, then call `step.ask()` (defaults to just asking). */
  onConfirm?: () => void;
  /** Stage 2 click: run the action with `step.code`. */
  onSubmit: () => void;
  block?: boolean;
  /** Stage 1 only: an extra button before the primary one (e.g. Cancel). */
  secondary?: ReactNode;
}) {
  const t = useTranslations('common');
  const { me } = useSession();
  if (!step.onCode) {
    return (
      <>
        {secondary}
        <Button variant="primary" block={block} icon={icon} disabled={disabled} busy={busy} onClick={onConfirm ?? step.ask}>
          {label}
        </Button>
      </>
    );
  }
  return (
    <div className="step-up-btns">
      <Button onClick={step.back} disabled={step.action.isPending}>
        {t('back')}
      </Button>
      <Button variant="primary" icon={icon} busy={step.action.isPending} disabled={!step.ready || !me.user.twoStepEnabled} onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}
