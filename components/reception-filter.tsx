'use client';

import { useEffect, useId, useRef, useState } from 'react';

const choices = [
  ['active', '進行中すべて'],
  ['seated-called-waiting', '開始待ち＋呼び出し中＋待機中'],
  ['waiting-called', '呼び出し中＋待機中'],
  ['waiting', '待機中'], ['called', '呼び出し中'], ['finished', '終了'], ['all', '本日のすべて'],
] as const;

export function ReceptionFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    options.current[choices.findIndex(([key]) => key === value)]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, value]);
  return <div className="reception-filter" ref={root} onKeyDown={event => {
    if (event.key === 'Tab') setOpen(false);
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button type="button" ref={trigger} className="reception-filter-trigger"
      aria-label={`受付状態で絞り込む：${choices.find(([key]) => key === value)?.[1]}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      {choices.find(([key]) => key === value)?.[1]}<span aria-hidden="true">⌄</span>
    </button>
    {open && <div id={id} role="listbox" aria-label="受付状態で絞り込む" className="reception-filter-menu" onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = options.current.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        options.current[next]?.focus();
      }
    }}>{choices.map(([key, label], index) => <button type="button" role="option" key={key}
      ref={element => { options.current[index] = element; }} tabIndex={-1} aria-selected={value === key}
      onClick={() => { onChange(key); setOpen(false); trigger.current?.focus(); }}>
      {label}<span aria-hidden="true">{value === key ? '✓' : ''}</span>
    </button>)}</div>}
  </div>;
}
