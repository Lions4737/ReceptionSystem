'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_EVENT_TITLE } from '../lib/branding';

const EventTitleContext = createContext<{ eventTitle: string; setEventTitle: (title: string) => void }>({
  eventTitle: DEFAULT_EVENT_TITLE,
  setEventTitle: () => {},
});

export function EventTitleProvider({ initialTitle, children }: { initialTitle: string; children: ReactNode }) {
  const [eventTitle, setEventTitle] = useState(initialTitle);
  const value = useMemo(() => ({ eventTitle, setEventTitle }), [eventTitle]);

  useEffect(() => { document.title = eventTitle; }, [eventTitle]);

  return <EventTitleContext.Provider value={value}>{children}</EventTitleContext.Provider>;
}

export function useEventTitle() { return useContext(EventTitleContext); }

export function EventTitle() { return <>{useEventTitle().eventTitle}</>; }
