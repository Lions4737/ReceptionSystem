import { cache } from 'react';
import { database } from '../db';
import { DEFAULT_EVENT_TITLE } from './branding';

// React caches this within a render so metadata and the layout use one value.
export const readEventTitle = cache(async () => {
  try {
    const settings = await database().prepare('SELECT event_name FROM settings WHERE id=1').first<{ event_name: string }>();
    return settings?.event_name.trim() || DEFAULT_EVENT_TITLE;
  } catch (error) {
    console.error('Could not load the event title', error);
    return DEFAULT_EVENT_TITLE;
  }
});
