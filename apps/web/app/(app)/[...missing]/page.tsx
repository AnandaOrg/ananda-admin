'use client';

import { NotFound } from '@/components/ui';

/** Any address inside the app that doesn't exist: "We can't find this page", with the shell around it. */
export default function Missing() {
  return <NotFound />;
}
