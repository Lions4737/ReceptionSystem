import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { session } from './auth';

export async function requireStaffPage(returnTo: string) {
  const request = new Request('https://app.local', { headers: await headers() });
  if (!await session(request, 'staff')) {
    redirect('/staff/login?returnTo=' + encodeURIComponent(returnTo));
  }
}
