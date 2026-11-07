'use client';
import Link from 'next/link';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { RestoreTicket, ReturnToTicket } from './ticket-recovery';
import { TicketExitWarning } from './ticket-exit-warning';
import { TableTimers } from './table-timers';
import { TableSettings } from './table-settings';
import { TicketStatusEditor } from './ticket-status-editor';
import { ReceptionFilter } from './reception-filter';
import { EventTitle, useEventTitle } from './event-title';
import { MAX_EVENT_TITLE_LENGTH } from '../lib/branding';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { canManageSettings, acceptsKind, targetTags, tableName, active, clockText, code, kindLabel, remaining, statusLabel, type Kind, type Snapshot, type Ticket } from '../lib/types';

async function post(path:string,body:Record<string,unknown>) {
  const payload={op:crypto.randomUUID(),...body};
  for(let attempt=0;attempt<2;attempt++) {
    let res:Response;
    try {res=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});} catch {if(attempt===0)continue;throw new Error('通信を確認できません。最新の状態を取得してから再試行してください。');}
    const data=await res.json() as Snapshot & {error?:string;key?:string}; if(!res.ok) {if(res.status>=500 && attempt===0)continue;throw new Error(data.error ?? '操作に失敗しました。');} window.dispatchEvent(new Event('festival-updated')); if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('festival-updates');channel.postMessage('updated');channel.close();} return data;
  }
}
function useSnapshot(scope='public') {
  const {setEventTitle}=useEventTitle();
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[sync,setSync]=useState(0),[now,setNow]=useState(0);
  const offset=useRef(0),loading=useRef<Promise<void>|null>(null),pending=useRef(false),mounted=useRef(true);
  const refresh=useCallback(()=>{
    pending.current=true;
    if(loading.current)return loading.current;
    loading.current=(async()=>{
      do {
        pending.current=false;
        try {
          const res=await fetch('/api/'+scope,{cache:'no-store'}), result=await res.json() as Snapshot & {error?:string};
          if(!res.ok)throw new Error(result.error??'通信に失敗しました');
          if(!mounted.current)return;
          offset.current=result.serverNow-performance.now();setData(result);setEventTitle(result.settings.event_name);setNow(result.serverNow);setSync(Date.now());setError('');
        } catch(e) { if(mounted.current)setError(e instanceof Error?e.message:'接続できません。'); }
      } while(pending.current && mounted.current);
    })().finally(()=>{loading.current=null;});
    return loading.current;
  },[scope,setEventTitle]);
  useEffect(()=>{
    mounted.current=true;queueMicrotask(()=>void refresh());
    const tick=setInterval(()=>{if(!document.hidden)void refresh();},scope==='staff'?2000:5000);
    const timer=setInterval(()=>setNow(performance.now()+offset.current),1000);
    const update=()=>{void refresh();};
    const visible=()=>{if(!document.hidden)update();};
    const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('festival-updates'):null;
    if(channel)channel.onmessage=update;
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('focus',visible);window.addEventListener('online',update);window.addEventListener('festival-updated',update);
    return()=>{
      mounted.current=false;clearInterval(tick);clearInterval(timer);channel?.close();
      document.removeEventListener('visibilitychange',visible);
      window.removeEventListener('focus',visible);window.removeEventListener('online',update);window.removeEventListener('festival-updated',update);
    };
  },[refresh,scope]);
  return {data,error,now,sync,refresh};
}
function useAction(refresh:()=>Promise<void>,scope:'staff'|'player'='staff') {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
  const run=async(path:string,body:Record<string,unknown>,success='保存しました')=>{
    if(lock.current)return false;lock.current=true;setBusy(true);setMessage('');
    try{await post(path,{...body,scope});await refresh();void success;setMessage('');return true;}catch(e){setMessage(e instanceof Error?e.message:'操作を確認できません。');await refresh();return false;}finally{lock.current=false;setBusy(false);}
  };return{busy,message,run,clearMessage:()=>setMessage('')};
}
const currency=(v:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(v);
const time=(v:number|null)=>v?new Date(v).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}):'—';
const roleLabel:Record<string,string>={admin:'責任者',reception:'受付スタッフ',operator:'運営スタッフ',dealer:'ディーラー',player:'来場者'};
function Brand({dark=false}:{dark?:boolean}){const {eventTitle}=useEventTitle();return <Link className="brand" href="/" aria-label={eventTitle+' ホーム'}><span className="brand-mark"><Image className="brand-logo" src={dark?"/utpoker-logo-dark.svg":"/utpoker-logo.svg"} alt="" width={36} height={36} unoptimized/></span><span className="brand-title">{eventTitle}</span></Link>;}
function Pill({status}:{status:Ticket['status']}){return <span className={'pill '+status}><i/>{statusLabel[status]}</span>;}
function KindBadge({kind,tags}:{kind:Kind;tags:ReturnType<typeof targetTags>}){return <span className={'kind '+kind}>{kindLabel(kind,tags)}</span>;}
function Note({children}:{children:ReactNode}){return <div className="notice" role="status">{children}</div>;}
function Loading(){return <div className="loading" role="status"><span className="loading-rule" aria-hidden="true"/><p>会場の状況を確認しています</p></div>;}
function PublicHeader({dark=false}:{dark?:boolean}){return <header className="public-header"><Brand dark={dark}/></header>;}
function Frame({children,tab,data,error,sync,refresh}:{children:ReactNode;tab:string;data:Snapshot|null;error:string;sync:number;refresh:()=>Promise<void>}){
  const path=usePathname();const router=useRouter();
  const nav=[['/staff/reception','受付・待機列'],['/staff/table','テーブル管理'],['/staff/settings','運営設定']];
  const dealer=data?.me?.role==='dealer';
  return <div className="workspace"><aside className="sidebar"><Brand dark/><div className="sidebar-caption">FESTIVAL OPERATIONS</div><nav aria-label="運営メニュー">{nav.filter(n=>!dealer||n[0].includes('/table')).filter(n=>n[0]!=='/staff/settings'||canManageSettings(data?.me?.role)).map(([href,label])=><Link key={href} href={dealer?'/staff/table/'+data.me?.table_id:href} aria-current={path.startsWith(href.split('/').slice(0,3).join('/'))?'page':undefined} className={(path.startsWith(href.split('/').slice(0,3).join('/'))?'selected':'')}>{label}</Link>)}</nav><div className="sidebar-bottom"><Link href="/display" target="_blank">会場モニターを開く <span>↗</span></Link><div className="profile"><span className="avatar">{data?.me?.role==='admin'?'管':dealer?'D':'受'}</span><div>{data?.me?roleLabel[data.me.role]:'運営スタッフ'}<small><EventTitle/> TEAM</small></div>{data?.me&&<button aria-label="ログアウト" title="ログアウト" className="logout" onClick={async()=>{await post('logout',{});router.push('/staff/login');}}>↪</button>}</div></div></aside><div className="workspace-body"><header className="topbar"><span>運営コンソール <span className="crumb">/</span> <b>{tab}</b></span><div className="topbar-right"><span className={error?'connection offline':'connection'}><i/>{error?'未同期':sync?'接続中':'接続確認中'}</span><span className="date">{data?.day.replaceAll('-',' / ')??'—'}</span></div></header><main id="main-content" tabIndex={-1} className="main">{error&&<Note>{error} {sync?`最終同期 ${time(sync)}。表示は参考情報です。`:''} <button className="text-button" onClick={()=>void refresh()}>再取得</button>{!data&&<Link href="/staff/login">ログイン画面へ →</Link>}</Note>}{children}</main><footer className="workspace-footer"><EventTitle/> <span>PLAY. CONNECT. ENJOY.</span><span>スタッフ画面は2秒ごとに更新</span></footer></div></div>;
}
function Modal({title,onClose,children,hideTitle=false}:{title:string;onClose:()=>void;children:ReactNode;hideTitle?:boolean}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;const root=ref.current;root?.querySelector<HTMLElement>('input,select,button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const elements=root?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');if(!elements?.length)return;const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[onClose]);
  return <div className="modal-backdrop"><div className={hideTitle?"modal modal-without-title":"modal"} role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="section-head">{!hideTitle&&<h2>{title}</h2>}<button className="icon-button" aria-label="閉じる" onClick={onClose}>×</button></div>{children}</div></div>;
}
function Stats({data}:{data:Snapshot}) {
  const items=[['待機中',Object.values(data.queues??{}).reduce((sum,n)=>sum+n,0),'人',targetTags(data).map(tag=>tag.name+' '+(data.queues?.[tag.id]??0)).join(' / ')],['ご案内できる席',data.tables.filter(t=>!t.paused_at&&!t.assignment_locked).reduce((sum,t)=>sum+t.seat_count-(data.occupancy?.[t.id]??0),0),'席',`${data.tables.length}卓・計${data.tables.reduce((sum,t)=>sum+t.seat_count,0)}席`],['本日の売上',currency(data.revenue??0),'','入金 − 返金']];
  return <div className="stats">{items.map(([label,value,unit,note],i)=><div key={label} className={'stat '+(i===0?'featured':'')}><div className="stat-label">{label}</div><div className="stat-value">{value}<small>{unit}</small></div><div className="stat-note">{note}</div></div>)}</div>;
}
function TableOverview({data,now}:{data:Snapshot;now:number}) {
  return <section className="panel table-status-panel">
    <div className="section-head"><h2>テーブルの状況 <span className="subtle">TABLE STATUS</span></h2><Link className="text-link" href="/staff/table">詳細を見る ↗</Link></div>
    {!data.tables.length&&<div className="empty"><p>テーブルがまだありません。</p>{canManageSettings(data.me?.role)&&<Link className="text-link" href="/staff/settings#table-settings">テーブルを追加する →</Link>}</div>}
    <div className="table-overview">{data.tables.map(table=><Link className="table-summary" key={table.id} href={'/staff/table/'+table.id}>
      <div className="table-summary-head"><div><strong>{table.name}</strong><small>{kindLabel(table.kind,targetTags(data))}テーブル{table.assignment_locked?'・割り振りロック中':''}</small></div><span className="table-count">{data.occupancy?.[table.id]??0}<small> / {table.seat_count}</small></span></div>
      <div className="seat-dots" style={{gridTemplateColumns:`repeat(${table.seat_count}, minmax(0, 1fr))`}}>{Array.from({length:table.seat_count},(_,i)=>{
        const ticket=data.tickets.find(t=>t.table_id===table.id&&t.seat===i+1&&['called','seated','playing'].includes(t.status));
        const milliseconds=ticket?.status==='playing'?remaining(ticket,now,table):null;
        const endingSoon=milliseconds!==null&&milliseconds<=5*60_000;
        const label=milliseconds!==null?(milliseconds<=0?'時間終了':`プレイ中 · 残り${clockText(milliseconds)}`):ticket?statusLabel[ticket.status]:'空席';
        return <span key={i} title={ticket?`${code(ticket)} · ${label}`:label} aria-label={`${i+1}番席 · ${label}`} className={[ticket?.status,endingSoon?'ending-soon':''].filter(Boolean).join(' ')}>{i+1}</span>;
      })}</div>
      <div className="table-caption"><span className={table.paused_at?'pause-dot':'live-dot'}/>{table.paused_at?'一時停止中':table.seat_count-(data.occupancy?.[table.id]??0)+'席 ご案内できます'}<span>→</span></div>
    </Link>)}</div>
  </section>;
}

export function Reception(){
  const state=useSnapshot('staff'),{data,refresh}=state,action=useAction(refresh),statusAction=useAction(refresh);
  const [correction,setCorrection]=useState<Ticket|null>(null);
  const closeCorrection=useCallback(()=>setCorrection(null),[]);
  const [statusTicket,setStatusTicket]=useState<Ticket|null>(null);
  const closeStatus=useCallback(()=>{if(!statusAction.busy)setStatusTicket(null);},[statusAction.busy]);
  const [kind,setKind]=useState('all'),[filter,setFilter]=useState('seated-called-waiting'),[search,setSearch]=useState(''),[modal,setModal]=useState<'proxy'|Ticket|null>(null),[chosen,setChosen]=useState('');
  const close=useCallback(()=>setModal(null),[]);
  const router=useRouter();useEffect(()=>{if(data?.me?.role==='dealer')router.replace('/staff/table/'+data.me.table_id);},[data,router]);
  const available=data?.tables.flatMap(table=>Array.from({length:table.seat_count},(_,i)=>({table,seat:i+1}))).filter(x=>!x.table.paused_at && !x.table.assignment_locked && !data.tickets.some(t=>t.table_id===x.table.id&&t.seat===x.seat&&['called','seated','playing'].includes(t.status)))??[];
  const searchTerm = search.toLowerCase();
  const shown = data?.tickets.filter(ticket => {
    const matchesStatus = filter === 'active' ? active(ticket)
      : filter === 'seated-called-waiting' ? ['seated', 'called', 'waiting'].includes(ticket.status)
      : filter === 'waiting-called' ? ['called', 'waiting'].includes(ticket.status)
      : filter === 'all' || ticket.status === filter;
    return matchesStatus && (kind === 'all' || ticket.kind === kind) &&
      `${code(ticket)} ${ticket.nickname}`.toLowerCase().includes(searchTerm);
  }) ?? [];
  const mutate=(t:Ticket,name:string)=>action.run('action',{id:t.id,version:t.version,action:name});
  return <Frame {...state} tab="受付・待機列">{!data?<Loading/>:<><Stats data={data}/><TableOverview data={data} now={state.now}/>
    <section className="reception-waiting" aria-labelledby="reception-waiting-title">
      <h2 id="reception-waiting-title">現在の待ち人数</h2>
      <dl>
        {targetTags(data).map(tag=>(
          <div key={tag.id}>
            <dt>{tag.name}</dt>
            <dd><strong>{data.queues?.[tag.id] ?? 0}</strong> 人</dd>
          </div>
        ))}
      </dl>
    </section>
    <section className="panel queue-panel"><div className="section-head"><h2>受付一覧</h2><div className="queue-filters"><div className="tabs">{[['all','すべて'],...targetTags(data).map(tag=>[tag.id,tag.name])].map(([k,label])=><button key={k} className={kind===k?'active':''} onClick={()=>setKind(k)}>{label}</button>)}</div><div className="search"><span>⌕</span><input placeholder="受付番号・ニックネームを検索" aria-label="受付を検索" value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="toolbar"><ReceptionFilter value={filter} onChange={setFilter}/>{data.me?.role==='admin'&&<a download className="button small outline" href="/api/export">↓ CSV</a>}</div></div>{action.message&&<p className="form-help" role="status">{action.message}</p>}<div className="table-scroll"><table className="queue-table reception-table"><colgroup><col className="reception-name-col"/><col className="reception-kind-col"/><col className="reception-time-col"/><col className="reception-status-col"/><col/><col className="reception-actions-col"/></colgroup><thead><tr><th>受付番号 / お名前</th><th>種別</th><th>受付時刻</th><th>ステータス</th><th>テーブル / 座席</th><th>操作</th></tr></thead><tbody>{shown.map(t=><tr key={t.id}><td><b className="ticket-code">{code(t)}</b><small className="reception-nickname" title={t.nickname}>{t.nickname}</small></td><td><KindBadge kind={t.kind} tags={targetTags(data)}/></td><td className="mono">{time(t.created_at)}</td><td><Pill status={t.status}/></td><td>{t.table_id?<><span className="reception-assigned-seat" title={tableName([...data.tables,...(data.archivedTables??[])],t.table_id)+' / '+t.seat+'番席'}><b>{tableName([...data.tables,...(data.archivedTables??[])],t.table_id)}</b>{!data.tables.some(table=>table.id===t.table_id)&&<span className="muted">（削除済み卓）</span>}<span className="muted"> / {t.seat}番席</span></span></>:t.status==='called'?<span className="muted">{t.paid?'入金済み・席の案内待ち':'入金待ち'}</span>:'—'}</td><td><div className="row-actions">{t.status==='waiting'&&<button disabled={action.busy||!!state.error} className="button small primary" onClick={()=>{void mutate(t,'call');}}>呼び出す ↗</button>}{t.status==='called'&&<><button className="button small primary" disabled={action.busy||!!state.error} onClick={()=>{if(t.paid){action.clearMessage();setModal(t);setChosen('auto');}else void mutate(t,'pay');}}>{t.paid?'席を割り振る':'入金 '+currency(t.fee)}</button>{!t.paid&&<button className="text-button muted" disabled={action.busy||!!state.error||state.now-(t.called_at??state.now)<180000} onClick={()=>void mutate(t,'hold')}>不在</button>}</>}{t.status==='seated'&&<span className="muted">ディーラーの開始待ち</span>}{t.status==='playing'&&<span className="mono">{clockText(remaining(t,state.now,data.tables.find(x=>x.id===t.table_id)))}</span>}{t.status==='hold'&&<button disabled={action.busy} className="button small outline" onClick={()=>void mutate(t,'requeue')}>先頭へ戻す</button>}{t.status==='finished'&&<span className="mono">{t.final_chips?.toLocaleString()} pt</span>}{['waiting','hold'].includes(t.status)&&<button className="text-button muted" disabled={action.busy} onClick={()=>{setModal({...t,last_op:'confirm-cancel'});}}>取消</button>}
    {data.me?.role==='admin' && t.status==='finished' &&
      <button className="button small outline" disabled={action.busy||!!state.error}
        onClick={()=>{action.clearMessage();setCorrection(t);}}>
        点数を訂正
      </button>}
    {(data.me?.role==='admin'||data.me?.role==='reception'||data.me?.role==='operator')&&<button
      type="button"
      className="reception-edit-button"
      aria-label={code(t)+'のステータスを編集'}
      title="ステータスを編集"
      disabled={action.busy||statusAction.busy||!!state.error}
      onClick={()=>{statusAction.clearMessage();setStatusTicket({...t});}}
    >
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M16 1.5H7a5.5 5.5 0 0 0-5.5 5.5v14A5.5 5.5 0 0 0 7 26.5h14a5.5 5.5 0 0 0 5.5-5.5v-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="m8 20 1.3-3.6L22 3.7l2.3 2.4-12.7 12.7L8 20Zm15.6-18 1.6-1.6a1.6 1.6 0 0 1 2.3 2.3l-1.6 1.6L23.6 2Z" fill="currentColor"/>
      </svg>
    </button>}</div></td></tr>)}</tbody></table></div>{!shown.length&&<div className="empty"><h3>ここから、今日のゲームが始まります。</h3><p>受付が入ると、こちらに表示されます。<br/>スマホがない方は「代理受付」から登録できます。</p></div>}<div className="panel-footer"><span><i className="live-dot"/>待機順に表示しています</span><span>未入金のまま呼び出しから1時間で自動保留</span></div></section><div className="tip"><div><b>次のプレイヤーも、気持ちよく。</b><p>説明後にディーラーが時間を開始します。終了・点数確定後に、次の方をご案内ください。</p></div></div></>}{modal&&<Modal title={modal==='proxy'?'代理受付':modal.last_op==='confirm-cancel'?'受付の取り消し':code(modal)+(modal.status==='called'&&modal.paid?' の席を割り振る':' を呼び出す')} onClose={close}>{modal==='proxy'?<form onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await action.run('join',{nickname:f.get('nickname'),kind:f.get('kind'),proxy:true},'代理受付を登録しました'))close();}}><label>ニックネーム<input name="nickname" maxLength={30} placeholder="空欄なら自動で名前をつけます"/></label><label>希望テーブル<select name="kind" defaultValue={targetTags(data).find(tag=>data&&acceptsKind(data,tag.id))?.id}>{targetTags(data).map(tag=><option key={tag.id} value={tag.id} disabled={!data||!acceptsKind(data,tag.id)}>{tag.name}</option>)}</select></label><p className="form-help">料金の受け取りは、呼び出し後に登録します。</p>{action.message&&<Note>{action.message}</Note>}<button className="button primary full" disabled={action.busy}>受付を登録</button></form>:modal.last_op==='confirm-cancel'?<><p>{code(modal)} の受付を取り消します。</p><button className="button danger full" disabled={action.busy} onClick={async()=>{if(await mutate(modal,'cancel'))close();}}>取り消す</button></>:modal.status==='called'&&modal.paid?<form onSubmit={async e=>{e.preventDefault();const [table,seat]=chosen.split(':');if(await action.run('action',{action:'seat',id:modal.id,version:modal.version,...(chosen==='auto'?{auto:true}:{table,seat:Number(seat)})},'席を確保し、着席案内を登録しました'))close();}}><label>案内する座席<select value={chosen} onChange={e=>setChosen(e.target.value)} required><option value="auto">自動で割り振る</option>{available.filter(x=>x.table.kind===modal.kind).map(x=><option key={x.table.id+':'+x.seat} value={x.table.id+':'+x.seat}>{x.table.name} · {x.seat}番席</option>)}</select></label>{action.message&&<p className="settings-error" role="alert">{action.message}</p>}{!available.some(x=>x.table.kind===modal.kind)&&<p className="settings-error" role="status">現在、案内できる空席がありません。入金済みのまま、空席ができてから割り振れます。</p>}<button className="button primary full" disabled={action.busy||!!state.error||!chosen||!available.some(x=>x.table.kind===modal.kind)}>{chosen==='auto'?'自動で席を割り振って案内する':'この席に案内する'}</button></form>:null}</Modal>}{statusTicket&&data&&<Modal title={code(statusTicket)+' のステータス変更'} onClose={closeStatus}><TicketStatusEditor key={statusTicket.id} ticket={statusTicket} data={data} busy={statusAction.busy} error={statusAction.message} offline={!!state.error} onSave={async body=>{if(await statusAction.run('action',body))setStatusTicket(null);}}/>
    <button type="button" className="button outline full"
      disabled={data.me?.role!=='admin' || !statusTicket.paid || !['called','seated'].includes(statusTicket.status)
        || action.busy || statusAction.busy || !!state.error}
        onClick={()=>{
          action.clearMessage();
          setCorrection(statusTicket);
          setStatusTicket(null);
        }}>
      返金して取消
    </button>
  </Modal>}{correction&&<Modal title={code(correction)+(correction.status==='finished'?' の点数訂正':' の返金・取消')} onClose={closeCorrection}><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await action.run('action',{id:correction.id,version:correction.version,action:correction.status==='finished'?'correct':'refund',score:Number(f.get('score')),reason:f.get('reason')})){closeCorrection();}}}>{correction.status==='finished'?<label>最終チップ数<input name="score" type="number" min="0" max="10000000" required defaultValue={correction.final_chips??0}/></label>:<p>{currency(correction.fee)}の現金返却を確認してから確定してください。</p>}<label>理由<textarea name="reason" required maxLength={200}/></label>{action.message&&<Note>{action.message}</Note>}<button className="button primary full" disabled={action.busy}>変更を確定</button></form></Modal>}</Frame>;
}

export function Dealer({id:requestedId}:{id?:string}) {
  const state=useSnapshot('staff'),{data,refresh,now}=state,action=useAction(refresh);
  const id=requestedId??(data?.me?.role==='dealer'?data.me.table_id:data?.tables[0]?.id)??'';
  const [timeEdit,setTimeEdit]=useState<{ticket:Ticket; seconds:number}|null>(null);
  const timeAction=useAction(refresh);
  const closeTime=useCallback(()=>setTimeEdit(null),[]);
  const [selectedFinish,setFinish]=useState<Ticket|null>(null);
  const finish=selectedFinish && data?.tickets.find(ticket=>ticket.id===selectedFinish.id && ticket.table_id===id && ticket.status==='playing');
  const close=useCallback(()=>setFinish(null),[]);
  const table=data?.tables.find(t=>t.id===id);
  return <Frame {...state} tab="テーブル管理">
    {!data?(state.error?<p role="alert">{state.error} <Link className="text-link" href="/staff/login">スタッフログインへ</Link></p>:<Loading/>):<TableTimers id={id} data={data} now={now} busy={action.busy||timeAction.busy} error={state.error} message={action.message||(!timeEdit?timeAction.message:undefined)||''}
      onMove={(ticket,seat)=>void action.run('action',{action:'move-seat',id:ticket.id,version:ticket.version,seat})}
      onStart={ticket=>void action.run('action',{action:'start',id:ticket.id,version:ticket.version},`${ticket.minutes}分のプレイを開始しました`)}
      onFinish={setFinish}
      onEditTime={ticket=>{
        action.clearMessage();
        timeAction.clearMessage();
        setTimeEdit({ticket,seconds:Math.max(0,Math.ceil(remaining(ticket,now,table)/1000))});
      }}
      onTogglePause={()=>{if(table)void action.run('table',{table:id,version:table.version},table.paused_at?'卓全体の時間を再開しました':'卓全体の時間を一時停止しました');}}/>}
    {timeEdit&&<Modal title={code(timeEdit.ticket)+' の残り時間を修正'} onClose={closeTime}>
      <form onSubmit={async event=>{
        event.preventDefault();
        const {ticket,seconds}=timeEdit;
        if(await timeAction.run('action',{action:'adjust-time',id:ticket.id,version:ticket.version,seconds},'残り時間を修正しました'))closeTime();
      }}>
        <p>{timeEdit.ticket.nickname} · {timeEdit.ticket.seat}番席</p>
        <div className="time-stepper">
          {[
            {label:'時間', unit:3600, max:3},
            {label:'分', unit:60, max:59},
            {label:'秒', unit:1, max:59},
          ].map(({label,unit,max},index)=>{
            const value=Math.floor(timeEdit.seconds/unit)%(max+1);
            const bump=(direction:number)=>setTimeEdit(current=>{
              if(!current)return current;
              const part=Math.floor(current.seconds/unit)%(max+1);
              const next=(part+direction+max+1)%(max+1);
              return {...current,seconds:Math.min(10800,current.seconds+(next-part)*unit)};
            });
            return <Fragment key={label}>
              {index>0&&<span className="time-stepper-colon" aria-hidden="true">:</span>}
              <div className="time-stepper-field" role="spinbutton" tabIndex={timeAction.busy?-1:0}
                aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-disabled={timeAction.busy}
                onKeyDown={event=>{
                  if(!timeAction.busy&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
                    event.preventDefault();
                    bump(event.key==='ArrowUp'?1:-1);
                  }
                }}
                ref={element=>{
                  if(!element||timeAction.busy)return;
                  const onWheel=(event:WheelEvent)=>{
                    event.preventDefault();
                    if(event.deltaY!==0)bump(event.deltaY<0?1:-1);
                  };
                  element.addEventListener('wheel',onWheel,{passive:false});
                  return ()=>element.removeEventListener('wheel',onWheel);
                }}>
                <button type="button" tabIndex={-1} aria-label={label+'を増やす'} disabled={timeAction.busy} onClick={()=>bump(1)}>▲</button>
                <span>{String(value).padStart(2,'0')}</span>
                <button type="button" tabIndex={-1} aria-label={label+'を減らす'} disabled={timeAction.busy} onClick={()=>bump(-1)}>▼</button>
              </div>
            </Fragment>;
          })}
        </div>
        {timeAction.message&&<p role="alert">{timeAction.message}</p>}
        <button className="button primary full" disabled={timeAction.busy||!!state.error}>残り時間を保存</button>
      </form>
    </Modal>}
    {finish&&<Modal title={code(finish)+' の結果を確定'} onClose={close} hideTitle>
      <form onSubmit={async event=>{
        event.preventDefault();
        const form=new FormData(event.currentTarget);
        if(await action.run('action',{action:'finish',id:finish.id,version:finish.version,score:Number(form.get('score'))},'結果を確定し、席を空けました'))close();
      }}>
        <p><strong>{finish.nickname}さん · {table?.name} / {finish.seat}番席</strong></p>
        <label>最終チップ数<input autoFocus type="text" inputMode="numeric" name="score" required pattern="[0-9]+" maxLength={8} placeholder="例：1500" title="0〜10000000の半角数字の整数を入力してください"
          onChange={event=>{
            const input=event.currentTarget;
            input.setCustomValidity(input.value && (!/^[0-9]+$/.test(input.value)||Number(input.value)>10000000)
              ? '0〜10000000の半角数字の整数を入力してください。' : '');
          }}/></label>
        <p className="form-help">0点も入力必須です。確定後、次の方を案内できます。</p>
        {action.message&&<p role="status">{action.message}</p>}
        <button className="button primary full" disabled={action.busy||!!state.error}>結果を確定して終了</button>
      </form>
    </Modal>}
  </Frame>;
}

export function PublicHome() {
  const {data,error}=useSnapshot();
  return <div className="public-page">
    <PublicHeader/>
    <main id="main-content" tabIndex={-1}>
      <ReturnToTicket/>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow">CAMPUS POKER EXPERIENCE</div>
            <h1 id="home-title">はじめての一手が、<br/>今日をおもしろく。</h1>
            <p>戦略・心理・確率。考える楽しさを、テーブルで。<br/>ルールの説明から始める、学園祭のポーカー体験。</p>
            <div className="hero-actions">
              <Link className="button primary large" href="/join">参加する <span aria-hidden="true">→</span></Link>
              <Link className="text-link" href="/me">自分の受付を見る <span aria-hidden="true">→</span></Link>
            </div>
          </div>
          <dl className="hero-facts" aria-label="参加のご案内">
            <div><dt>プレイ時間</dt><dd>{data?.settings.minutes??30}<span>分 / 人</span></dd></div>
            <div><dt>参加料</dt><dd>{currency(data?.settings.fee??500)}<span>/ 回</span></dd></div>
            <div><dt>テーブル</dt><dd>{data?.tables.length??'—'}<span>卓 / 計{data?.tables.reduce((sum,t)=>sum+t.seat_count,0)??'—'}席</span></dd></div>
          </dl>
        </div>
        <div className="hero-footer"><span>PLAY. CONNECT. ENJOY.</span><span>初心者歓迎 / ルール説明あり</span></div>
      </section>
      {error&&<div className="home-notice"><Note>{error}</Note></div>}
      <section className="public-section" aria-labelledby="venue-title">
        <div className="section-head">
          <div><div className="eyebrow">LIVE AT THE VENUE</div><h2 id="venue-title">いまの会場</h2></div>
          <span className={error?'connection offline':'connection'}><i aria-hidden="true"/>{error?'更新できません':data?'5秒ごとに更新':'接続確認中'}</span>
        </div>
        <div className="public-status">
          {targetTags(data).map(tag=>tag.id).map(kind=><article key={kind}>
            <div className="public-status-header">
              <KindBadge kind={kind} tags={targetTags(data)}/>
              <span className="admission-state">{data?acceptsKind(data,kind)?'受付中':'受付を停止しています':'状況を確認中'}</span>
            </div>
            <h3>{kind==='beginner'?'はじめてでも、気軽に。':kind==='expert'?'いつもの一手を、新しい仲間と。':'このタグのテーブルで楽しもう。'}</h3>
            <div className="public-queue"><b>{data?.queues?.[kind]??'—'}<small>人待ち</small></b><span>{data?.waitMinutes?.[kind]==null?'時間は受付でご確認ください':`目安 約${data.waitMinutes[kind]}分`}</span></div>
            <p>{data?`${kindLabel(kind,targetTags(data))}向け ${data.tables.filter(t=>t.kind===kind).length}卓 / 計${data.tables.filter(t=>t.kind===kind).reduce((sum,t)=>sum+t.seat_count,0)}席`:'テーブルの状況を確認中'}</p>
          </article>)}
        </div>
      </section>
      <section className="public-section howto" aria-labelledby="howto-title">
        <div className="eyebrow">HOW TO JOIN</div><h2 id="howto-title">受付から、最初の一手まで。</h2>
        <div className="steps">
          {[['01','スマホで受付','ニックネームと希望の卓を選びます。'],['02','番号でお呼び出し','呼ばれたら受付へ。参加料をお支払いください。'],['03','テーブルで楽しむ','ルールの説明後、ディーラーが時間を開始します。']].map(([n,t,d])=><div key={n}><span aria-hidden="true">{n}</span><h3>{t}</h3><p>{d}</p></div>)}
        </div>
      </section>
    </main>
    <footer className="public-footer"><Brand/><span>PLAY. CONNECT. ENJOY.</span></footer>
  </div>;
}

export function Join(){const {data,error,refresh}=useSnapshot();const action=useAction(refresh),router=useRouter();const [kind,setKind]=useState<Kind>('beginner'),[ready,setReady]=useState(false),[identityError,setIdentityError]=useState('');
  const [validationError, setValidationError] = useState('');
  useEffect(()=>{let current=true;void (async()=>{await post('identity',{});const res=await fetch('/api/me',{cache:'no-store'});const mine=await res.json() as Snapshot & {error?:string};if(!res.ok)throw new Error(mine.error??'受付を確認できませんでした。');if(!current)return;if(mine.tickets.some(active))router.replace('/me');else setReady(true);})().catch(e=>{if(current)setIdentityError(e.message);});return()=>{current=false;};},[router]);const open=data&&acceptsKind(data,kind);return <div className="public-page join-page"><PublicHeader dark/><main id="main-content" tabIndex={-1} className="mobile-main"><div className="eyebrow">TAKE YOUR SEAT</div><h1>ポーカー体験に参加する</h1><form className="panel join-form" noValidate onChange={() => setValidationError('')} onSubmit={async event => {
    event.preventDefault();
    if (!ready || !open || error || action.busy) return;
    const form = event.currentTarget;
    const nickname = form.elements.namedItem('nickname') as HTMLInputElement;
    const confirmed = form.elements.namedItem('confirmed') as HTMLInputElement;
    const name = nickname.value.trim();
    if (!name || name.length > 30) {
      setValidationError('ニックネームを1〜30文字で入力してください。');
      nickname.focus();
      return;
    }
    if (!confirmed.checked) {
      setValidationError('内容を確認し、チェックを入れてください。');
      confirmed.focus();
      return;
    }
    setValidationError('');
    if (await action.run('join', {nickname: name, kind}, '受付が完了しました')) router.push('/me');
  }}><label>ニックネーム<input name="nickname" required pattern={String.raw`.*\S.*`} title="ニックネームを入力してください" maxLength={30} placeholder="例：ポーカーペンギン"/></label><p className="field-label" id="table-kind-label">希望のテーブル</p><div className="kind-options" role="group" aria-labelledby="table-kind-label">{targetTags(data).map(tag=>tag.id).map(k=><button type="button" key={k} aria-pressed={kind===k} className={kind===k?'selected':''} onClick={()=>setKind(k)}><span className="option-heading"><b>{kindLabel(k,targetTags(data))}</b><span className="option-check" aria-hidden="true">{kind===k?'✓':''}</span></span><small>{k==='beginner'?'ルール説明から始めたい':k==='expert'?'ルールを知っている':'このタグのテーブルに参加する'}</small></button>)}</div><div className="join-summary"><span>1回 <b>{data?.settings.minutes??30}分</b></span><b>{currency(data?.settings.fee??500)}</b></div><ul className="help-list"><li>参加料は呼び出し後、受付でお支払いください。</li><li>離れる場合も受付画面を定期的にご確認ください。</li></ul><label className="checkbox"><input type="checkbox" name="confirmed" required/>内容を確認しました</label>{validationError && <p className="settings-error" role="alert">{validationError}</p>}{(error||action.message||identityError)&&<Note>{error||action.message||identityError}</Note>}<button className="button primary full large" disabled={!ready||!open||!!error||action.busy}>{action.busy?'受付を確認中…':open?'受付番号を受け取る →':'受付状況を確認してください'}</button></form></main></div>;}

export function MyTicket(){const state=useSnapshot('me'),{data,now,refresh}=state,action=useAction(refresh,'player');const current=data?.tickets.find(active),last=current??data?.tickets[0];const table=data?.tables.find(t=>t.id===last?.table_id);return <div className="public-page my-ticket-page"><PublicHeader dark/><main id="main-content" tabIndex={-1} className="mobile-main my-ticket-main" aria-label="受付状況">{state.error&&<Note>{state.error} 最後に取得した状態を表示しています。</Note>}{!data?<Loading/>:!last?<div className="panel empty"><h2>受付が見つかりません</h2><p>受付済みの方は、保存したリンクか復帰コードで開き直せます。</p><div className="personal-actions"><Link className="button primary" href="/restore">復帰コードで開く →</Link><Link className="button outline" href="/join">初めて受付する →</Link></div><p>リンクもコードもない方は、受付スタッフにお声がけください。</p></div>:<><section className={'personal-ticket panel '+last.status}><div className="personal-ticket-header"><span className="ticket-label">あなたの受付番号</span><span role="status">{(last.status==='waiting'||last.status==='called')&&<span className="personal-ticket-status">{statusLabel[last.status]}</span>}</span></div><div className="personal-number">{code(last)}</div><p className="ticket-nickname">{last.nickname}さん</p><div className="ticket-divider"/>{last.status==='waiting'?<h2>あなたの前に <b>{Math.max(0,(data.position??1)-1)}</b> 人</h2>:last.status==='called'?<><h2>{last.paid?'入金を確認しました':'受付にお越しください'}</h2>{last.paid ? <p>席の案内をお待ちください。</p> : null}{last.table_id&&last.seat&&<div className="assigned-seat"><b>{table?.name??tableName(data.tables,last.table_id)}</b><span> / {last.seat}番席</span></div>}</>:last.status==='seated'?<><h2>{table?.name??tableName(data.tables,last.table_id)}・{last.seat}番席へ</h2><p>説明が終わったら、ディーラーが時間を開始します。</p></>:last.status==='playing'?<><div className="eyebrow">YOUR TIME</div><div className="personal-timer">{clockText(remaining(last,now,table))}</div><p>{table?.paused_at?'卓の時間を一時停止しています':remaining(last,now,table)<=0?'時間になりました。ディーラーの案内をお待ちください。':`${table?.name??tableName(data.tables,last.table_id)} · ${last.seat}番席 / 終了予定 ${time(last.ends_at)}`}</p></>:last.status==='finished'?<><div className="eyebrow">NICE GAME!</div><h2>ご参加ありがとうございました</h2><div className="final-score">{last.final_chips?.toLocaleString()}<small>pt</small></div><p>初期 {last.initial_chips.toLocaleString()} pt / 増減 {(last.final_chips??0)-last.initial_chips>=0?'+':''}{((last.final_chips??0)-last.initial_chips).toLocaleString()} pt</p></>:<><h2>{last.status==='hold'?'受付でスタッフにお声がけください':'受付を取り消しました'}</h2><p>{last.status==='hold'?'不在のため保留中です。復帰時は待機列の先頭からご案内します。':'またのご参加をお待ちしています。'}</p></>}</section>{current&&<TicketExitWarning/>}{action.message&&<Note>{action.message}</Note>}{!current&&<div className="personal-actions"><Link className="button primary" href="/join">もう一度参加する →</Link></div>}{current&&['waiting','called','hold'].includes(current.status)&&!current.paid&&<details className="cancel-details"><summary>受付を取り消したい場合</summary><p>取り消すと待機列から外れます。</p><button className="button danger" disabled={action.busy} onClick={()=>void action.run('action',{action:'cancel',id:current.id,version:current.version})}>受付を取り消す</button></details>}</>}<div className="tip"><div><b>呼び出しを見逃さないために</b><p>画面を閉じている間は通知されません。45秒ごとに更新します。会場モニターと口頭でもご案内します。</p></div></div></main></div>;}

export function Login() {
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const router=useRouter();
  const signingIn=useRef(false);
  const signIn=useCallback(async (password: string) => {
    if (signingIn.current) return;
    signingIn.current=true;
    setBusy(true);
    setError('');
    try {
      await post('login',{password});
      const response=await fetch('/api/staff',{cache:'no-store'});
      if (!response.ok) throw new Error('スタッフのログインを確認できませんでした。');
      const {me}=await response.json() as Snapshot;
      const destination=new URLSearchParams(window.location.search).get('returnTo');
      const allowed=destination==='/display' || destination==='/staff/reception' ||
        destination==='/staff/settings' || /^\/staff\/table(?:\/[a-zA-Z0-9_-]+)?$/.test(destination??'');
      router.replace(destination && allowed && (me?.role!=='dealer' || destination==='/display')
        ? destination
        : me?.role==='dealer' ? '/staff/table/'+encodeURIComponent(me.table_id??'') : '/staff/reception');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ログインできませんでした。');
    } finally {
      signingIn.current=false;
      setBusy(false);
    }
  },[router]);

  return <div className="login-page">
    <div className="login-story">
      <Brand dark/>
      <div>
        <div className="eyebrow">BEHIND EVERY GOOD GAME.</div>
        <h1>いい時間を、<br/>みんなでつくる。</h1>
        <p><EventTitle/><br/>スタッフ専用の運営コンソール</p>
      </div>
    </div>
    <main id="main-content" tabIndex={-1} className="login-main">
      <div>
        <div className="eyebrow">WELCOME, TEAM</div>
        <h1>スタッフログイン</h1>
        <form onSubmit={event=>{event.preventDefault();void signIn(password);}}>
          <label>パスワード
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/>
          </label>
          {error&&<Note>{error}</Note>}
          <button className="button primary full large" disabled={busy}>{busy?'確認しています…':'運営画面へ →'}</button>
        </form>
      </div>
    </main>
  </div>;
}

function EventSettingsForm({settings, busy, save}: {
  settings: Snapshot['settings'];
  busy: boolean;
  save: (values: {event_name: string; fee: number; minutes: number; chips: number}) => Promise<void>;
}) {
  const [name, setName] = useState(settings.event_name);
  const [fee, setFee] = useState(String(settings.fee));
  const [minutes, setMinutes] = useState(String(settings.minutes));
  const [chips, setChips] = useState(String(settings.chips));
  const values = {event_name: name.trim(), fee: Number(fee), minutes: Number(minutes), chips: Number(chips)};
  const changed = values.event_name !== settings.event_name || values.fee !== settings.fee
    || values.minutes !== settings.minutes || values.chips !== settings.chips;

  return <section className="panel settings-panel">
    <h2>イベントと受付設定</h2>
    <form onSubmit={async e => {
      e.preventDefault();
      if (changed && !busy) await save(values);
    }}>
      <label>イベント名<input name="event_name" required maxLength={MAX_EVENT_TITLE_LENGTH} value={name} onChange={e => setName(e.target.value)} autoComplete="off"/></label>
      <div className="form-grid">
        <label>参加料（円）<input name="fee" type="number" min="0" max="100000" required value={fee} onChange={e => setFee(e.target.value)}/></label>
        <label>1人の時間（分）<input name="minutes" type="number" min="1" max="180" required value={minutes} onChange={e => setMinutes(e.target.value)}/></label>
      </div>
      <label>初期チップ<input name="chips" type="number" min="1" max="1000000" required value={chips} onChange={e => setChips(e.target.value)}/></label>
      <button className="button primary full" disabled={busy || !changed || !values.event_name || !fee || !minutes || !chips}>設定を変更</button>
    </form>
  </section>;
}

export function SettingsPage() {
 const state=useSnapshot('staff'),{data,refresh}=state,action=useAction(refresh);
 return <Frame {...state} tab="運営設定"><div className="page-heading"><div className="eyebrow">FESTIVAL SETTINGS</div><h1>運営設定</h1><p>イベントとテーブルの設定を行います。</p></div>{!data?<Loading/>:!canManageSettings(data.me?.role)?<Note>この画面は運営権限が必要です。</Note>:<>{action.message&&<Note>{action.message}</Note>}<TableSettings data={data} offline={!!state.error} onChange={async body=>{try{await post('table-config',body);}finally{await refresh();}}}/><div className="settings-grid"><EventSettingsForm
   key={JSON.stringify([data.settings.event_name,data.settings.fee,data.settings.minutes,data.settings.chips])}
   settings={data.settings}
   busy={action.busy}
   save={async values=>{await action.run('settings',values);}}
 /></div>
 <section className="panel">
   <div className="section-head"><h2>イベント集計（累計）</h2></div>
   <div className="table-scroll">
     <table className="queue-table">
       <thead><tr><th scope="col">種別</th><th scope="col">入金済み参加人数</th><th scope="col">入金額（返金差引後）</th><th scope="col">最高得点</th></tr></thead>
       <tbody>
         {targetTags(data).map(tag=>{
           const stats = data.participationStats?.find(item=>item.kind===tag.id);
           return <tr key={tag.id}>
             <td>{tag.name}</td>
             <td>{stats?.participants ?? 0} 人</td>
             <td>{currency(stats?.revenue ?? 0)}</td>
             <td>{stats?.highScore == null ? '—' : stats.highScore.toLocaleString('ja-JP') + ' pt'}</td>
           </tr>;
         })}
       </tbody>
     </table>
   </div>
 </section>
 </>}</Frame>;
}

// The registration URL follows the address used to open the monitor.
const subscribeToDisplayOrigin = () => () => {};
const getDisplayOrigin = () => window.location.origin;
const getServerDisplayOrigin = () => '';

export function Display() {
  const {data,error,now}=useSnapshot('display');
  const origin = useSyncExternalStore(subscribeToDisplayOrigin, getDisplayOrigin, getServerDisplayOrigin);
  const tags = targetTags(data);
  return <div className="display-page">
    <header className="display-header">
      <div className="display-meta">
        <Brand dark/>
        <span className="display-time">{time(now)}</span>
      </div>
      <div className="display-intro">
        <h1>こちらの番号の方は、受付へ。</h1>
        <p>受付番号をスタッフにお見せください。</p>
      </div>
    </header>
    <main id="main-content" tabIndex={-1}>
      {error&&<Note>情報を更新できません。スタッフの案内をご確認ください。</Note>}
      <div className="display-layout">
        <div className="calling-grid">
          {data?.called?.length ? data.called.map(ticket => (
            <div key={ticket.code}>
              <b>{ticket.code}</b>
              <span>{ticket.table_id && ticket.seat
                ? tableName(data.tables,ticket.table_id) + ' / ' + ticket.seat + '番席'
                : '受付にお越しください'}</span>
            </div>
          )) : (
            <div className="display-empty">
              <h2>ただいま、ご案内の準備中です。</h2>
              <p>番号が表示されるまでお待ちください。</p>
            </div>
          )}
        </div>
        <aside className="display-registration" aria-label="参加受付と待ち人数">
          <Link className="display-qr" href="/join">
            {origin && <QRCodeSVG value={origin + '/join'} size={300} marginSize={4}/>}
            <span>QRコードから参加受付</span>
          </Link>
          <div className="display-bottom">
            {tags.map(({id}) => (
              <div key={id}>
                <span>{kindLabel(id,tags)}テーブル</span>
                <b>{data?.queues?.[id] ?? '—'} <small>人待ち</small></b>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  </div>;
}

export function Restore(){return <div className="public-page"><PublicHeader/><RestoreTicket/></div>;}
