import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EventAvailability } from '@/components/event-availability';
import { EventForm } from '@/components/event-form';
import { session } from '@/lib/auth';
import { DEFAULT_EVENT_SLUG, eventPath } from '@/lib/event-path';
import { eventTitle, listEvents } from '@/lib/events';

export const dynamic = 'force-dynamic';

export default async function EventList() {
  const staff = await session(new Request('https://app.local', {headers: await headers()}), 'staff');
  if (!staff) redirect(eventPath('/staff/login?returnTo=%2Fevent'));
  const allEvents = await listEvents();
  if (staff.role === 'dealer' && allEvents.some(event => event.slug === DEFAULT_EVENT_SLUG && event.enabled)) {
    redirect(eventPath('/staff/table/' + encodeURIComponent(staff.table_id ?? '')));
  }

  const canCreate = staff.role === 'admin' || staff.role === 'operator';
  const events = allEvents.filter(event => canCreate || event.slug === DEFAULT_EVENT_SLUG);
  const titles = await Promise.all(events.map(eventTitle));

  return (
    <div className="event-directory">
      <main id="main-content" className="mobile-main">
        <header className="event-directory-head">
          <h1>イベント一覧</h1>
          {canCreate && <EventForm/>}
        </header>
        <ul className="event-list">
          {events.map(({slug, enabled}, index) => (
            <li key={slug}>
              {enabled ? (
                <Link className="event-list-card" href={eventPath('/staff', slug)}>
                  <strong>{titles[index] ?? slug} <small>({slug})</small></strong>
                  <span>運営画面を開く →</span>
                </Link>
              ) : (
                <div className="event-list-card event-list-card-disabled">
                  <strong>{titles[index] ?? slug} <small>({slug})</small></strong>
                  <span>利用停止中</span>
                </div>
              )}
              {staff.role === 'admin' && <EventAvailability key={Number(enabled)} slug={slug} enabled={!!enabled}/>}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
