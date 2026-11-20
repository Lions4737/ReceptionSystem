'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';

export function EventForm() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: form.get('name'), slug: form.get('slug')}),
      });
      const result = await response.json() as {slug?: string; error?: string};
      if (!response.ok || !result.slug) throw new Error(result.error ?? 'イベントを追加できませんでした。');
      formElement.reset();
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'イベントを追加できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="event-add-button" aria-label="新しいイベントを追加"
        aria-haspopup="dialog" onClick={() => { setError(''); dialog.current?.showModal(); }}>
        <span aria-hidden="true">+</span>
      </button>
      <dialog ref={dialog} className="event-dialog" aria-labelledby={titleId}
        onCancel={event => { if (busy) event.preventDefault(); }}>
        <div className="event-dialog-head">
          <h2 id={titleId}>新しいイベント</h2>
          <button type="button" className="event-dialog-close" aria-label="閉じる"
            disabled={busy} onClick={() => dialog.current?.close()}>×</button>
        </div>
        <form className="event-form" onSubmit={submit}>
          <label>イベント名<input name="name" required maxLength={80}/></label>
          <label>URL名<input name="slug" required maxLength={48} pattern={"[a-zA-Z0-9]+(?:\\-[a-zA-Z0-9]+)*"} placeholder="summer-festival" autoCapitalize="none"/></label>
          {error && <p role="alert">{error}</p>}
          <button className="button event-submit" disabled={busy}>{busy ? '追加中…' : 'イベントを追加'}</button>
        </form>
      </dialog>
    </>
  );
}
