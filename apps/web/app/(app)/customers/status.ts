/** Customer status pills, as on the prototype's Customers list. */
export const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'mute' | 'blue'> = {
  active: 'good',
  late: 'bad',
  free_to_claim: 'mute',
  needs_approval: 'blue',
  draft: 'mute',
  declined: 'bad',
  archived: 'mute',
};
