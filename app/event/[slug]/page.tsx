import { redirect } from 'next/navigation';
import { eventPath } from '@/lib/event-path';

export default async function Page({params}: {params: Promise<{slug: string}>}) {
  redirect(eventPath('/join', (await params).slug));
}
