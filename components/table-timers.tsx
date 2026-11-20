'use client';

import { useEventPath } from './event-routing';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { canManageSettings, code, targetTags, kindLabel, remaining, type Snapshot, type Ticket } from '../lib/types';
import styles from './table-timers.module.css';

type Props = {
  id: string;
  data: Snapshot;
  now: number;
  busy: boolean;
  error: string;
  message: string;
  onStart: (ticket: Ticket) => void;
  onReentry: (ticket: Ticket) => void;
  onFinish: (ticket: Ticket) => void;
  onEditTime: (ticket: Ticket) => void;
  onTogglePause: () => void;
  onMove: (ticket: Ticket, seat: number) => void;
};

function Countdown({ milliseconds, empty = false }: { milliseconds: number; empty?: boolean }) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  return <span className={styles.countdown} role="timer" aria-label={empty ? '空席' : `残り${parts[0]}時間${parts[1]}分${parts[2]}秒`}>
    {parts.map((value, index) => <span className={styles.timePart} key={index}>
      {index > 0 && <span className={styles.colon} aria-hidden="true">:</span>}
      <span aria-hidden="true">{empty ? '—' : String(value).padStart(2, '0')}</span>
    </span>)}
  </span>;
}

// Multi-Timer's compact, three-column timer surface, connected to reception
// tickets and the shared server clock instead of device-local timer state.
export function TableTimers({ id, data, now, busy, error, message, onStart, onFinish, onReentry, onEditTime, onTogglePause, onMove }: Props) {
  const eventPath = useEventPath();
  const [moving, setMoving] = useState<number | null>(null);
  const [dropSeat, setDropSeat] = useState<number | null>(null);
  const [dragPoint, setDragPoint] = useState<{x:number;y:number;width:number;height:number} | null>(null);
  const pointer = useRef<{ticket: Ticket; x: number; y: number; offsetX:number; offsetY:number; width:number; height:number; dragged: boolean} | null>(null);
  const table = data.tables.find(item => item.id === id);
  const occupied = data.tickets.filter(ticket => ticket.table_id === id && ['called', 'seated', 'playing'].includes(ticket.status));
  const authorized = data.me?.role === 'admin' || data.me?.role === 'operator' || data.me?.role === 'dealer' && data.me.table_id === id;
  const paused = Boolean(table?.paused_at);
  const disabled = busy || Boolean(error);

  if (!table) return <section className={styles.board}>
    <h1>{data.tables.length ? 'このテーブルは現在使われていません' : 'テーブルがまだありません'}</h1>
    <p className="form-help">{data.tables.length ? '別のテーブルを選択してください。' : '運営設定からテーブルを追加してください。'}</p>
    <div className={styles.navigation}><nav aria-label="テーブルを選択">{data.tables.filter(item => data.me?.role !== 'dealer' || item.id === data.me.table_id).map(item => <Link key={item.id} href={eventPath('/staff/table/') + item.id}>{item.name}</Link>)}</nav></div>
    {canManageSettings(data.me?.role) ? <Link className="button outline" href={eventPath('/staff/settings#table-settings')}>テーブル構成を設定する</Link> : data.me?.role === 'dealer' && <p>担当テーブルの変更は運営スタッフにご確認ください。</p>}
  </section>;

  return <section className={`${styles.board}${paused ? ` ${styles.paused}` : ''}`} aria-label={`${table.name} のタイマー`}>
    <header className={styles.header}>
      <div className={styles.title}><h1>{table.name}</h1><span>{kindLabel(table.kind,targetTags(data))}</span></div>
      {authorized && <div className={styles.allControls} aria-label="卓全体のタイマー操作">
        <button type="button" className={styles.stopAll} disabled={disabled || paused} onClick={onTogglePause}>Ⅱ 一括停止</button>
        <button type="button" disabled={disabled || !paused} onClick={onTogglePause}>▶ 一括再開</button>
      </div>}
    </header>

    <div className={styles.navigation}>
      <nav aria-label="テーブルを選択">
        {data.tables.filter(item => data.me?.role !== 'dealer' || item.id === data.me.table_id).map(item =>
          <Link key={item.id} href={eventPath('/staff/table/') + item.id} aria-current={id === item.id ? 'page' : undefined}>{item.name}</Link>
        )}
      </nav>
      <div className={styles.configuration}>
        <span>{occupied.length} / {table.seat_count} 席 {!authorized && '・表示のみ'}</span>
        {canManageSettings(data.me?.role) && <Link className={styles.settingsLink} href={eventPath('/staff/settings#table-settings')}>テーブル・席数を設定 ↗</Link>}
      </div>
    </div>

    {!!table.assignment_locked && <p className={styles.pauseNotice} role="status">割り振りロック中 · この卓への新しいご案内を停止しています</p>}
    <span className="sr-only" role="status">{paused ? '卓全体を一時停止中' : ''}</span>
    {(error || message) && <p className={styles.message} role="status">{error || message}</p>}

    <div className={styles.grid}>
      {Array.from({ length: table.seat_count }, (_, index) => {
        const ticket = occupied.find(item => item.seat === index + 1);
        const milliseconds = ticket ? remaining(ticket, now, table) : 0;
        const playing = ticket?.status === 'playing';
        const expired = playing && milliseconds <= 0;
        const endingSoon = playing && milliseconds > 0 && milliseconds <= 5 * 60_000;
        const status = !ticket ? '空席' : ticket.status === 'called' ? ticket.paid ? '着席案内待ち' : '会計待ち' : ticket.status === 'seated' ? '開始待ち' : expired ? '時間終了' : paused ? '一時停止中' : '計時中';
        const caption = !ticket ? '着席するとタイマーが表示されます' : expired ? '' : playing ? paused ? '再開するまで時間は進みません' : '' : ticket.status === 'seated' ? '' : '受付でのご案内をお待ちください';

        const movable = authorized && !disabled && !!ticket?.paid && ['seated','playing'].includes(ticket.status);
        const target = authorized && !disabled && !ticket && moving !== null;
        const moveHere = () => {
          const source = occupied.find(item => item.id === moving);
          if (target && source) onMove(source, index + 1);
          setMoving(null); setDropSeat(null);
        };
        return <article key={index} className={`${styles.card} ${!ticket ? styles.empty : ''} ${endingSoon ? styles.endingSoon : ''} ${expired ? styles.expired : ''} ${movable ? styles.movable : ''} ${moving === ticket?.id ? styles.dragging : ''} ${target ? styles.availableTarget : ''} ${target && dropSeat === index + 1 ? styles.dropTarget : ''}`}
          data-seat={index + 1} data-empty={!ticket ? 'true' : 'false'}
          draggable={false} tabIndex={movable || target ? 0 : undefined}
          onPointerDown={event => {
            if (!movable || !ticket || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
            const rect=event.currentTarget.getBoundingClientRect();
            pointer.current = {ticket, x:event.clientX, y:event.clientY, offsetX:event.clientX-rect.left, offsetY:event.clientY-rect.top, width:rect.width, height:rect.height, dragged:false};
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={event => {
            const source=pointer.current;
            if (!source) return;
            if (Math.hypot(event.clientX-source.x,event.clientY-source.y)<8 && !source.dragged) return;
            source.dragged=true; setMoving(source.ticket.id);
            setDragPoint({x:event.clientX-source.offsetX,y:event.clientY-source.offsetY,width:source.width,height:source.height});
            const destination=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('article[data-seat]');
            setDropSeat(destination?.dataset.empty==='true' ? Number(destination.dataset.seat) : null);
          }} onPointerUp={event => {
            const source=pointer.current; pointer.current=null;
            const destination=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('article[data-seat]');
            if (source?.dragged && destination?.dataset.empty==='true' && event.currentTarget.parentElement?.contains(destination) && !disabled) onMove(source.ticket,Number(destination.dataset.seat));
            setMoving(null); setDropSeat(null); setDragPoint(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }} onPointerCancel={() => { pointer.current=null; setMoving(null); setDropSeat(null); setDragPoint(null); }}
          title={movable ? '空席へドラッグして移動（Enterで選択もできます）' : target ? 'ここへ移動' : undefined}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Escape') { pointer.current=null; setMoving(null); setDropSeat(null); setDragPoint(null); }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (movable && ticket) setMoving(ticket.id); else moveHere(); }
          }} aria-label={`${index + 1}番席 ${status}${endingSoon ? '・残り5分以下' : ''}${target ? '・移動先に選択可能' : ''}`}>
          <div className={styles.cardHeader}><h2>SEAT {String(index + 1).padStart(2, '0')}</h2>{status !== '計時中' && <span className={styles.status}>{status}</span>}</div>
          <div className={styles.identity}>
            {ticket ? <><b>{code(ticket)}</b><span title={ticket.nickname}>{ticket.nickname}</span></> : <span>受付からご案内します</span>}
          </div>
          {playing && authorized ? <button type="button" className={styles.editTime}
            aria-label={`${index + 1}番席の残り時間を修正`} title="残り時間を修正"
            disabled={disabled} onClick={() => onEditTime(ticket)}>
            <Countdown milliseconds={milliseconds}/>
          </button> : <Countdown milliseconds={milliseconds} empty={!ticket}/>}
          {(caption || target) && <p className={styles.caption}>{target ? dropSeat === index + 1 ? 'ここで離して移動' : 'ここへドラッグして移動' : caption}</p>}
          {!!ticket?.reentry_count && <p className={styles.caption}>リエントリー {ticket.reentry_count}回</p>}
          {ticket && <div className={styles.controls}>
            {playing && table.kind==='expert' && ticket.kind==='expert' && authorized && <button type="button" disabled={disabled || expired} onClick={()=>onReentry(ticket)}>リエントリー · ¥{data.settings.reentry_fee.toLocaleString()}</button>}
            {!playing && <button type="button" disabled={disabled || !authorized || ticket.status !== 'seated' || paused} onClick={() => onStart(ticket)}>▶ 開始</button>}
            {playing && <button type="button" disabled={disabled || !authorized} onClick={() => onFinish(ticket)}>終了・点数入力</button>}
          </div>}
        </article>;
      })}
    </div>
    {moving !== null && dragPoint && (() => {
      const ticket=occupied.find(item=>item.id===moving);
      if (!ticket) return null;
      const milliseconds=remaining(ticket,now,table);
      const playing=ticket.status==='playing';
      const expired=playing && milliseconds<=0;
      const endingSoon=playing && milliseconds>0 && milliseconds<=5*60_000;
      return <div className={`${styles.card} ${styles.dragPreview} ${expired ? styles.expired : ''} ${endingSoon ? styles.endingSoon : ''}`} aria-hidden="true"
        style={{left:dragPoint.x,top:dragPoint.y,width:dragPoint.width,height:dragPoint.height}}>
        <div className={styles.cardHeader}><h2>SEAT {String(ticket.seat).padStart(2,'0')}</h2>
          {(expired || !playing || paused) && <span className={styles.status}>{expired ? '時間終了' : playing ? '一時停止中' : '開始待ち'}</span>}
        </div>
        <div className={styles.identity}><b>{code(ticket)}</b><span>{ticket.nickname}</span></div>
        <Countdown milliseconds={milliseconds}/>
        {playing && paused && !expired && <p className={styles.caption}>再開するまで時間は進みません</p>}
        <div className={styles.controls}><button type="button" tabIndex={-1}>{playing ? '終了・点数入力' : '▶ 開始'}</button></div>
      </div>;
    })()}
  </section>;
}
