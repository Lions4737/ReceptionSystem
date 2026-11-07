'use client';

import { useEffect } from 'react';

// Mount only while a ticket is active. Mobile browsers may skip beforeunload,
// so the reminder to keep the browser open must also be visible on the page.
export function TicketExitWarning() {
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers require returnValue. The browser chooses the message.
      event.returnValue = 'true';
    };

    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, []);

  return <aside className="ticket-exit-warning" aria-label="ブラウザを閉じないでください">
    <svg className="ticket-exit-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 11v5m0-8h.01"/>
    </svg>
    <div>
      <strong>ブラウザを閉じないでください</strong>
      <p>一度ブラウザを閉じると、現在の受付状況が確認できなくなります。</p>
    </div>
  </aside>;
}
