'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { DEFAULT_EVENT_SLUG, eventPath } from '@/lib/event-path';

export function useEventPath() {
  const pathname = usePathname();
  const slug = pathname?.match(/^\/event\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1] ?? DEFAULT_EVENT_SLUG;
  return useCallback((path: string) => eventPath(path, slug), [slug]);
}
