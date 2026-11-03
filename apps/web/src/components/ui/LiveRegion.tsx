'use client';

import { selectAnnouncement, useUi } from '@/stores/ui';

export function LiveRegion() {
  const announcement = useUi(selectAnnouncement);
  return <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>;
}
