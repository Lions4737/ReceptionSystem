'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function EventAvailability({slug, enabled}: {slug: string; enabled: boolean}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/events', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({slug, enabled: !enabled}),
      });
      if (!response.ok) {
        const result = await response.json() as {error?: string};
        throw new Error(result.error ?? '設定を更新できませんでした。');
      }
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '設定を更新できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="event-availability">
      <button type="button" className="button outline small" disabled={busy} onClick={toggle}
        aria-label={slug + (enabled ? ' を無効にする' : ' を有効にする')}>
        {enabled ? '無効にする' : '有効にする'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
