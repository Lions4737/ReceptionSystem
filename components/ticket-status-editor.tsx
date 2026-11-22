'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { assignedStatuses, manualStatuses, manualStatusIssue, manualStatusWarning } from '../lib/manual-status';
import { scoreValue, statusLabel, targetTags, type Kind, type Role, type Snapshot, type Status, type Ticket } from '../lib/types';

type Props = {
  ticket: Ticket; data: Snapshot; busy: boolean; error: string; offline: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
};

function StatusPicker({ value, ticket, role, disabled, onChange }: {
  value: Status; ticket: Ticket; role: Role;
  disabled: boolean; onChange: (status: Status) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = useRef<Partial<Record<Status, HTMLButtonElement | null>>>({});
  const descriptions: Record<Status, string> = {
    waiting: ticket.status === 'hold' ? '待機列の先頭へ' : '待機列の末尾へ',
    called: '会場モニターで呼び出し',
    seated: '選んだ席で開始待ち',
    playing: `${ticket.minutes}分の計時を開始`,
    finished: '終了して席を解放',
    hold: '席を解放して保留',
    cancelled: '受付を取り消す',
  };

  useLayoutEffect(() => {
    const popup = menu.current;
    const button = trigger.current;
    if (!open || !popup || !button) return;

    const gap = 6;
    const viewportMargin = 8;
    const positionMenu = () => {
      const anchor = button.getBoundingClientRect();
      const below = Math.max(0, document.documentElement.clientHeight - anchor.bottom - gap - viewportMargin);
      const above = Math.max(0, anchor.top - gap - viewportMargin);
      const naturalHeight = Math.min(320, popup.scrollHeight + 2);
      const opensAbove = below < naturalHeight && above > below;
      popup.style.maxHeight = `${Math.min(320, opensAbove ? above : below)}px`;
      popup.style.left = `${Math.max(viewportMargin, Math.min(anchor.left, document.documentElement.clientWidth - popup.offsetWidth - viewportMargin))}px`;
      popup.style.top = `${opensAbove ? anchor.top - gap - popup.offsetHeight : anchor.bottom + gap}px`;
    };

    popup.showPopover();
    positionMenu();
    options.current[value]?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      popup.hidePopover();
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, value]);

  return <div className="status-picker" ref={root} onKeyDownCapture={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span className="status-picker-label" id={`${id}-label`}>変更後のステータス</span>
    <button type="button" className="status-edit-button" ref={trigger} disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-options` : undefined} onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      <span className={`pill ${value}`}><i aria-hidden="true"/><span id={`${id}-value`}>{statusLabel[value]}</span><span className="status-edit-chevron" aria-hidden="true">⌄</span></span>
    </button>
    {open && <div className="status-picker-menu" popover="manual" ref={menu} id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = manualStatuses.findIndex(status => options.current[status] === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? manualStatuses.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + manualStatuses.length) % manualStatuses.length;
        options.current[manualStatuses[next]]?.focus();
      }
    }}>{manualStatuses.map(status => {
      const issue = manualStatusIssue(ticket, status, role);
      return <button type="button" key={status} className="status-picker-option" role="option"
        ref={element => { options.current[status] = element; }} tabIndex={-1}
        aria-selected={status === value} disabled={disabled}
        title={issue ?? undefined} onClick={() => { onChange(status); setOpen(false); trigger.current?.focus(); }}>
        <span className={`pill ${status}`}><i aria-hidden="true"/>{statusLabel[status]}</span>
        <span className="status-picker-hint">
          {status === ticket.status ? '現在のステータス' : issue ? null : descriptions[status]}
          {!issue && ticket.status === 'finished' && status !== 'finished' && <><br/>結果をリセット</>}
        </span>
        {status === value && <span aria-hidden="true">✓</span>}
      </button>;
    })}</div>}
  </div>;
}

export function TicketStatusEditor({ ticket, data, busy, error, offline, onSave }: Props) {
  const seatWarningId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [nickname, setNickname] = useState(ticket.nickname);
  const [status, setStatus] = useState<Status>(ticket.status);
  const [kind, setKind] = useState(ticket.kind);
  const originalSeat = ticket.table_id && ticket.seat ? `${ticket.table_id}:${ticket.seat}` : '';
  const [seat, setSeat] = useState(originalSeat);
  const statusChanged = status !== ticket.status;
  const nicknameChanged = nickname.trim() !== ticket.nickname;
  const role = data.me?.role ?? 'player';
  const needsSeat = status !== 'called' && assignedStatuses.includes(status);
  const kindChanged = kind !== ticket.kind;
  const seatChanged = needsSeat && seat !== originalSeat;
  const mustChooseSeat = needsSeat && (statusChanged || kindChanged || seatChanged);
  const sourceTable = data.tables.find(table => table.id === ticket.table_id);
  const canChooseSeat = statusChanged || status === 'seated' ||
    (status === 'playing' && ['admin', 'reception', 'operator'].includes(role) && sourceTable?.paused_at === null);
  // Same-kind tables first; other-kind tables are allowed for manual moves.
  const available = [...data.tables].sort((a, b) => Number(a.kind !== kind) - Number(b.kind !== kind)).flatMap(table =>
    Array.from({ length: table.seat_count }, (_, i) => ({ table, seat: i + 1 }))
  ).filter(s => {
    const keepsSeat = assignedStatuses.includes(ticket.status) && ticket.table_id === s.table.id && ticket.seat === s.seat;
    if (keepsSeat) return !statusChanged || status === 'seated' || s.table.paused_at === null;
    return s.table.paused_at === null && !s.table.assignment_locked &&
      !data.tickets.some(t => t.id !== ticket.id && t.table_id === s.table.id && t.seat === s.seat && assignedStatuses.includes(t.status));
  });
  const validSeat = available.some(s => `${s.table.id}:${s.seat}` === seat);
  const noAvailableSeats = mustChooseSeat && !available.length;
  const selectedIssue = manualStatusIssue(ticket, status, role);
  const warning = manualStatusWarning(ticket, status);
  const current = data.tickets.find(t => t.id === ticket.id);
  const stale = !current || current.version !== ticket.version;

  return <form className="status-editor" onSubmit={async event => {
    event.preventDefault();
    if (selectedIssue || busy || stale || offline || (warning && !acknowledged)) return;
    const form = new FormData(event.currentTarget), [table, number] = seat.split(':');
    await onSave({ action: 'set-status', id: ticket.id, version: ticket.version, status,
      ...(nicknameChanged ? { nickname: nickname.trim() } : {}),
      ...(kindChanged ? { kind } : {}),
      ...(mustChooseSeat ? { table, seat: Number(number) } : {}),
      ...(statusChanged && status === 'finished' ? { score: scoreValue(form.get('score')) } : {}) });
  }}>
    <label className="status-editor-player">プレイヤーネーム
      <input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={30} required disabled={busy}/>
    </label>
    <label>
      <span className="status-editor-kind-heading">種別
        <small id={seatWarningId} role="status">{noAvailableSeats ? '案内できる席がありません' : ''}</small>
      </span>
      <select aria-label="種別" aria-describedby={noAvailableSeats ? seatWarningId : undefined} value={kind} disabled={busy || (needsSeat && !canChooseSeat)} onChange={event => {
      const next = event.target.value as Kind;
      setKind(next);
      setSeat(next === ticket.kind ? originalSeat : '');
    }}>
      {targetTags(data).map(tag => <option key={tag.id} value={tag.id}>{tag.name}（{tag.id === 'beginner' ? 'B' : 'E'}）</option>)}
    </select></label>
    <StatusPicker value={status} ticket={ticket} role={role} disabled={busy} onChange={next => {
      setStatus(next); setAcknowledged(false);
      if (next !== 'called' && assignedStatuses.includes(next) && !validSeat) {
        const first = available.find(option => option.table.paused_at === null); setSeat(first ? `${first.table.id}:${first.seat}` : '');
      }
    }}/>
    {needsSeat && <label>テーブル・席<select value={validSeat ? seat : ''} required={mustChooseSeat} disabled={busy || !canChooseSeat} onChange={event => setSeat(event.target.value)}>
      <option value="">席を選択してください</option>{available.map(s => <option key={`${s.table.id}:${s.seat}`} value={`${s.table.id}:${s.seat}`}>{s.table.name} · {s.seat}番席{s.table.kind !== kind ? `（${targetTags(data).find(tag => tag.id === s.table.kind)?.name ?? s.table.kind}卓）` : ''}</option>)}
    </select></label>}
    {status === 'finished' && status !== ticket.status && <label>最終チップ数<input name="score" type="number" min={0} max={10000000} step={1} placeholder="未入力で記録なし" disabled={busy}/></label>}
    {(error || selectedIssue || stale || offline) && <p className="settings-error" role="alert">{selectedIssue || error || (stale ? '他の操作で更新されました。一度閉じて、最新の受付から開き直してください。' : '接続を確認してから変更してください。')}</p>}
    {<div className="status-change-warning" role="alert"><strong>ステータス変更の注意</strong><p>{warning}</p><label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event=>setAcknowledged(event.target.checked)}/>影響を確認して変更する</label></div>}
    <button className="button primary full" disabled={busy || offline || stale || (!!warning && !acknowledged) || !nickname.trim() || (!statusChanged && !nicknameChanged && !kindChanged && !seatChanged) || !!selectedIssue || (mustChooseSeat && (!canChooseSeat || !validSeat))}>{busy ? '変更中…' : '変更を保存'}</button>
  </form>;
}
