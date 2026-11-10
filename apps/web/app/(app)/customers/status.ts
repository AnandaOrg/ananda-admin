export const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'mute' | 'blue'> = {
  active: 'good',
  late: 'bad',
  free_to_claim: 'blue',
  needs_approval: 'warn',
  draft: 'mute',
  declined: 'bad',
  archived: 'mute',
};
