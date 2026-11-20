import type { ReactNode } from 'react';
import { EventTitleProvider } from '@/components/event-title';
import { readEventTitle } from '@/lib/event-title';

export default async function EventLayout({children, params}: {
  children: ReactNode;
  params: Promise<{slug: string}>;
}) {
  const {slug} = await params;
  return <EventTitleProvider key={slug} initialTitle={await readEventTitle()}>{children}</EventTitleProvider>;
}
