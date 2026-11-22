'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { planTableMoves } from '../lib/table-moves';
import { code, tableName, DEFAULT_TABLE_SEATS, targetTags, MAX_TABLE_NAME_LENGTH, MAX_TABLE_SEATS, type GameTable, type Snapshot } from '../lib/types';

type Change = (body: Record<string, unknown>) => Promise<boolean>;
type Props = { data: Snapshot; offline: boolean; onChange: (body: Record<string, unknown>) => Promise<void> };
type MoveReview = ReturnType<typeof planTableMoves> & { source: GameTable; completed: boolean };

function TableMoveDialog({ title, busy, completed, onClose, children }: {
  title: string; busy: boolean; completed: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const root = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    root?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      root?.close(); document.body.style.overflow = overflow;
      const target = previous instanceof HTMLButtonElement && previous.disabled
        ? previous.closest('tr')?.querySelector<HTMLElement>('.table-cell-value') : previous;
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { if (completed) heading.current?.focus(); }, [completed]);
  return <dialog className="modal table-move-dialog" ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="section-head">
      <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
      <button type="button" className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}>×</button>
    </div>
    {children}
  </dialog>;
}

function InlineTableValue({ table, field, disabled, onChange }: { table: GameTable; field: 'name' | 'seat_count'; disabled: boolean; onChange: Change }) {
  const [editing, setEditing] = useState<{ table: GameTable; value: string } | null>(null);
  const submitting = useRef(false), cancelled = useRef(false);
  const label = `${table.name}の${field === 'name' ? '名前' : '席数'}`;
  const save = async (input: HTMLInputElement) => {
    if (!editing || submitting.current || cancelled.current || disabled) return;
    if (!input.reportValidity()) return;
    const value = field === 'name' ? editing.value.trim() : Number(editing.value);
    if (value === editing.table[field]) { setEditing(null); return; }
    submitting.current = true;
    const success = await onChange({ action: 'update', table: table.id, version: editing.table.version, name: editing.table.name, kind: editing.table.kind, seat_count: editing.table.seat_count, [field]: value });
    submitting.current = false;
    if (success) setEditing(null);
  };
  return editing ? <input className="table-cell-input" aria-label={label} autoFocus required disabled={disabled}
    type={field === 'name' ? 'text' : 'number'} min={field === 'seat_count' ? 1 : undefined} max={field === 'seat_count' ? MAX_TABLE_SEATS : undefined}
    maxLength={field === 'name' ? MAX_TABLE_NAME_LENGTH : undefined} step={field === 'seat_count' ? 1 : undefined}
    value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })}
    onBlur={event => void save(event.currentTarget)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); void save(event.currentTarget); }
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setEditing(null); }
    }}/>
    : <button className="table-cell-value" type="button" disabled={disabled} aria-label={`${label}を変更`} title="クリックして変更 · Enterまたはフォーカスを外すと保存"
      onClick={() => { cancelled.current = false; setEditing({ table: { ...table }, value: String(table[field]) }); }}>
      {field === 'name' ? table.name : `${table.seat_count}席`}
    </button>;
}

export function TableSettings({ data, offline, onChange }: Props) {
  const [adding, setAdding] = useState(false), [removing, setRemoving] = useState<GameTable | null>(null);
  const [moving, setMoving] = useState<MoveReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const disabled = busy || offline;
  const run: Change = async body => {
    if (lock.current || offline) return false;
    lock.current = true; setBusy(true); setError('');
    try { await onChange(body); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '変更できませんでした。'); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const tags = targetTags(data);
  const totalSeats = data.tables.reduce((total, table) => total + table.seat_count, 0);
  const reviewMoves = (source: GameTable) => {
    setMoving({ source: { ...source }, ...planTableMoves(source, data.tables, data.tickets), completed: false });
    setError('');
  };
  const currentSource = moving && data.tables.find(t => t.id === moving.source.id);
  const currentPlan = currentSource && planTableMoves(currentSource, data.tables, data.tickets);
  const staleMoves = !!moving && !moving.completed && (!currentSource || currentSource.version !== moving.source.version ||
    JSON.stringify(currentPlan) !== JSON.stringify({ occupants: moving.occupants, available: moving.available, moves: moving.moves }));
  const enoughSeats = !!moving && moving.occupants.length > 0 && moving.moves.length === moving.occupants.length;
  const closeMoving = () => { if (!lock.current) { setMoving(null); setError(''); } };

  return <section className="panel table-settings" id="table-settings" aria-labelledby="table-settings-title">
    <div className="section-head">
      <div><h2 id="table-settings-title">テーブル・席数設定</h2><p className="form-help">0卓から自由に追加できます。各テーブルの名前・対象タグ・席数を設定してください。</p></div>
      <button className="button primary" disabled={disabled || adding || !!removing} onClick={() => { setAdding(true); setError(''); }}>＋ テーブルを追加</button>
    </div>
    <p className="table-settings-summary">{data.tables.length}卓 <span>／</span> 合計 {totalSeats}席</p>
    {offline && !moving && <p className="settings-error" role="alert">接続を確認しています。変更する前に最新の状態を取得してください。</p>}
    {error && !moving && <p className="settings-error" role="alert">{error}</p>}
    <span className="sr-only" role="status">{busy ? '保存中です' : ''}</span>
    {adding && <form className="table-config-editor" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (await run({ action: 'create', name: form.get('name'), kind: form.get('kind'), seat_count: Number(form.get('seat_count')) })) setAdding(false);
    }}>
      <h3>新しいテーブル</h3>
      <div className="table-config-fields">
        <label>テーブル名<input name="name" required maxLength={MAX_TABLE_NAME_LENGTH} placeholder="例：初心者テーブル 1" autoFocus disabled={disabled}/></label>
        <label>対象タグ<select name="kind" defaultValue="beginner" disabled={disabled}>{tags.map(tag=><option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
        <label>席数<input name="seat_count" type="number" min={1} max={MAX_TABLE_SEATS} required defaultValue={DEFAULT_TABLE_SEATS} disabled={disabled}/><small>初期値{DEFAULT_TABLE_SEATS}席／1〜{MAX_TABLE_SEATS}席</small></label>
      </div>
      <div className="table-config-actions"><button className="button primary" disabled={disabled}>{busy ? '保存中…' : 'テーブルを追加する'}</button><button type="button" className="button outline" disabled={busy} onClick={() => { setAdding(false); setError(''); }}>キャンセル</button></div>
    </form>}
    {moving && <TableMoveDialog
      title={moving.completed ? `「${moving.source.name}」を空にしました` : `「${moving.source.name}」の全員を他の卓へ移動`}
      busy={busy} completed={moving.completed} onClose={closeMoving}>
      {offline && <p className="settings-error" role="alert">接続を確認しています。変更する前に最新の状態を取得してください。</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {moving.completed ? <p role="status">全{moving.occupants.length}人の割り振りを変更しました。下の移動先へご案内ください。元の卓は割り振りロック中です。</p> :
        <><p>他の卓へ全員を移動し（同じ対象タグの卓を優先し、足りなければ別の対象タグの卓へ）、元の卓を割り振りロックします。入金・プレイ状況・残り時間を引き継ぎます。</p>
          <p className="form-help">移動する人数：{moving.occupants.length}人 ／ 移動先の空席：{moving.available}席<br/>ロック中の卓は移動先に含みません。</p>
          {!enoughSeats && <p className="settings-error" role="alert">{moving.occupants.length
            ? `全員を移すにはあと${moving.occupants.length - moving.available}席必要です。卓を追加するか、席数やロックを調整してください。`
            : 'この卓はすでに空です。'}</p>}
          {staleMoves && <p className="settings-error" role="alert">卓や席の状態が変わりました。移動先を更新して確認してください。</p>}
        </>}
      {!!moving.moves.length && <div className="table-scroll"><table className="queue-table table-move-list"><thead><tr><th>受付番号 / お名前</th><th>{moving.completed ? '移動前の席' : '現在の席'}</th><th>移動先</th></tr></thead><tbody>
        {moving.moves.map(move => {
          const ticket = moving.occupants.find(t => t.id === move.ticket_id)!;
          return <tr key={ticket.id}><td><b>{code(ticket)}</b><small>{ticket.nickname}</small></td><td>{ticket.seat}番席</td><td>{tableName(data.tables, move.table_id)} / {move.seat}番席</td></tr>;
        })}
      </tbody></table></div>}
      <div className="table-config-actions">
        {!moving.completed && <button className="button primary" disabled={disabled || staleMoves || !enoughSeats} onClick={async () => {
          if (await run({ action: 'empty', table: moving.source.id, version: moving.source.version, moves: moving.moves })) setMoving({ ...moving, completed: true });
        }}>{busy ? '移動中…' : '全員を移動して卓を空にする'}</button>}
        {!moving.completed && currentSource && <button className="button outline" disabled={disabled} onClick={() => reviewMoves(currentSource)}>移動先を更新</button>}
        <button className="button outline" disabled={busy} onClick={closeMoving}>{moving.completed ? '閉じる' : 'キャンセル'}</button>
      </div>
    </TableMoveDialog>}
    <div className="table-scroll"><table className="queue-table table-config-list"><colgroup><col className="table-config-name"/><col/><col className="table-config-seats"/><col/><col/><col className="table-config-delete"/></colgroup><thead><tr><th>テーブル名</th><th>対象タグ</th><th>席数</th><th>利用状況</th><th>割り振りロック</th><th>操作</th></tr></thead><tbody>
      {data.tables.map(table => {
        const occupancy = data.occupancy?.[table.id] ?? 0, rowDisabled = disabled || !!removing;
        const locked = Boolean(table.assignment_locked);
        return <tr key={table.id}>
          <td><InlineTableValue table={table} field="name" disabled={rowDisabled} onChange={run}/></td>
          <td><select className={`table-kind-tag ${table.kind}`} aria-label={`${table.name}の対象タグ`} value={table.kind} disabled={rowDisabled} title={occupancy ? '座っている方はそのまま続行し、以後の自動割り振りが新しい対象になります' : '対象タグを変更'}
            onChange={event => void run({ action: 'update', table: table.id, version: table.version, name: table.name, kind: event.target.value, seat_count: table.seat_count })}>{tags.map(tag=><option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></td>
          <td><InlineTableValue table={table} field="seat_count" disabled={rowDisabled} onChange={run}/></td>
          <td>{occupancy ? `${occupancy}席 利用中` : '空席'}{table.paused_at ? '・一時停止中' : ''}</td>
          <td><button type="button" role="switch" aria-checked={locked} aria-label={`${table.name}の割り振りロック`} className={`table-lock-button ${locked ? 'is-locked' : ''}`} disabled={rowDisabled}
            onClick={() => void run({ action: 'lock', table: table.id, version: table.version, locked: !locked })}>{locked ? 'ロック中' : '受付可能'}<span aria-hidden="true">{locked ? '●' : '○'}</span></button></td>
          <td><div className="table-row-actions"><button className="text-button" disabled={rowDisabled || adding || !occupancy} title={!occupancy ? 'この卓はすでに空です' : undefined} aria-label={`${table.name}を空にする`} onClick={() => reviewMoves(table)}>卓を空にする</button><button className="text-button table-remove" disabled={rowDisabled || occupancy > 0} title={occupancy ? '利用中のテーブルは削除できません' : undefined} aria-label={`${table.name}を削除`} onClick={() => { setRemoving({ ...table }); setError(''); }}>削除</button></div></td>
        </tr>;
      })}
    </tbody></table></div>
    {!data.tables.length && <div className="empty"><h3>テーブルを追加してください</h3><p>テーブルを用意すると、その対象の受付・席の割り当てができます。</p></div>}
    {removing && <div className="table-config-editor" role="group" aria-label="テーブル削除の確認">
      <h3>「{removing.name}」を削除しますか？</h3><p className="form-help">テーブルを一覧から削除します。過去の受付記録は残ります。</p>
      <div className="table-config-actions"><button className="button danger" disabled={disabled} onClick={async () => { if (await run({ action: 'archive', table: removing.id, version: removing.version })) setRemoving(null); }}>テーブルを削除する</button><button className="button outline" disabled={busy} onClick={() => { setRemoving(null); setError(''); }}>キャンセル</button></div>
    </div>}
  </section>;
}
