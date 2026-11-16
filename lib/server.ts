import { autoHoldStatements } from './auto-hold';
import { database, staffPassword } from "../db";
import { canManageSettings, active, code, targetTags, dayKey, estimateWait, reentryTerms, type GameTable, type ParticipationStats, type Session, type Settings, type Ticket } from "./types";
import { cookie, failure, hash, HttpError, legacyStaffCookie, operationId, payload, randomToken, requireRole, requireStaff, response, session, sessionToken, throttle, validSetupKey } from "./auth";
import { createRecovery, recoverVisitor } from './recovery';
import { MAX_EVENT_TITLE_LENGTH } from './branding';
import { configureTable } from './table-config';
import { statusCorrection } from './status-correction';
import { autoSeatTicket } from './auto-assignment';
const occupied = ['called','seated','playing'];
const rows = async <T>(sql:string,...args:(string|number|null)[]) => (await database().prepare(sql).bind(...args).all<T>()).results;
const getSettings = async () => (await database().prepare("SELECT * FROM settings WHERE id=1").first<Settings>())!;
function integer(value:unknown,min:number,max:number) { if(typeof value!=="number" || !Number.isInteger(value) || value<min || value>max) throw new HttpError(400,"数値の入力を確認してください。"); return value; }
const optional=(value:unknown,min:number,max:number)=>value===undefined?null:integer(value,min,max);
function text(value:unknown,max=30) { if(typeof value!=="string" || !value.trim() || value.trim().length>max) throw new HttpError(400,"入力内容を確認してください。"); return value.trim(); }
async function replay(op:string,s:Session) {
  const old=await database().prepare("SELECT actor FROM operations WHERE id=?").bind(op).first<{actor:string}>();
  if(old && old.actor!==s.user_id) throw new HttpError(403,"この操作を確認する権限がありません。"); return !!old;
}
async function snapshot(request:Request,scope:string) {
  const me=scope==='public'?null:await session(request,scope==='staff'||scope==='display'?'staff':'player'), now=Date.now(), day=dayKey(now);
  if((scope==='staff'||scope==='display') && (!me || me.role==='player')) throw new HttpError(401,"スタッフとしてログインしてください。");
  const db=database();
  // Read configuration and seats in one transaction so a concurrent move or
  // table edit cannot produce a snapshot combining different database states.
  const [, , settingsResult, tablesResult, ticketsResult] = await db.batch([
    ...autoHoldStatements(db, now),
    db.prepare("SELECT * FROM settings WHERE id=1"),
    db.prepare("SELECT * FROM game_tables ORDER BY length(id),id"),
    db.prepare("SELECT * FROM tickets WHERE day=? OR status IN ('waiting','called','seated','playing','hold') ORDER BY queued_at,id").bind(day),
  ]);
  const settings=settingsResult.results[0] as unknown as Settings;
  const allTables=tablesResult.results as unknown as GameTable[];
  const tickets=ticketsResult.results as unknown as Ticket[];
  const tables=allTables.filter(t=>t.archived_at===null);
  const tags = targetTags({settings});
  const queues = Object.fromEntries(tags.map(tag=>[tag.id,tickets.filter(t=>t.kind===tag.id && t.status==='waiting').length]));
  const occupancy=Object.fromEntries(tables.map(table=>[table.id,tickets.filter(t=>t.table_id===table.id && occupied.includes(t.status)).length]));
  const waitMinutes=Object.fromEntries(tags.map(tag=>[tag.id,estimateWait(tag.id,tables,tickets,now,settings.minutes)]));
  const base={serverNow:now,day,settings,tags,tables,queues,occupancy,waitMinutes};
  if(scope==='staff') {
    const visible=me!.role==='dealer' ? tickets.filter(t=>t.table_id===me!.table_id) : tickets;
    const revenue=me!.role==='dealer' ? undefined : (await database().prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE created_at>=? AND created_at<?").bind(Date.parse(day+'T00:00:00+09:00'),Date.parse(day+'T00:00:00+09:00')+86400000).first<{amount:number}>())?.amount;
    const participationStats = canManageSettings(me!.role) ? await rows<ParticipationStats>(`
      SELECT t.kind,
        SUM(CASE WHEN t.paid = 1 AND t.status <> 'cancelled' THEN 1 ELSE 0 END) AS participants,
        SUM(COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ticket_id = t.id), 0)) AS revenue,
        MAX(CASE WHEN t.status = 'finished' THEN t.final_chips END) AS highScore
      FROM tickets t
      GROUP BY t.kind
    `) : undefined;
    return response({...base,me,tickets:visible,archivedTables:canManageSettings(me!.role)?allTables.filter(t=>t.archived_at!==null):undefined,revenue,participationStats,total:tickets.filter(t=>t.day===day && t.status!=='cancelled').length});
  }
  if(scope==='me') {
    if(!me || me.role!=='player') return response({...base,me,tickets:[]});
    const mine=await rows<Ticket>("SELECT * FROM tickets WHERE player_id=? ORDER BY id DESC LIMIT 20",me.user_id);
    const current=mine.find(active);
    const ahead=current ? tickets.filter(t=>t.kind===current.kind && t.status==='waiting' && (t.queued_at<current.queued_at || (t.queued_at===current.queued_at && t.id<current.id))).length : 0;
    return response({...base,me,tickets:mine,position:ahead+1,mineWaitMinutes:current ? estimateWait(current.kind,tables,tickets,now,settings.minutes,ahead) : null});
  }
  return response({...base,me:null,tickets:[],called:scope==='display' ? tickets.filter(t=>t.status==='called').map(t=>({code:code(t),table_id:t.table_id,seat:t.seat})) : []});
}
async function login(request:Request,b:Record<string,unknown>) {
  await throttle(request);
  const token=randomToken(), tokenHash=await hash(token), db=database(), now=Date.now();
  const password = b.password ?? b.key;
  if(await validSetupKey(password)) {
    await db.prepare("INSERT INTO sessions(hash,user_id,role,expires_at) VALUES(?,?,'admin',?)").bind(tokenHash,'admin',now+12*3600000).run();
    return response({ok:true,role:'admin'},200,{'Set-Cookie':cookie(request,token,12*3600,'staff')});
  }
  const expected = staffPassword();
  if (expected || b.password !== undefined) {
    if (!expected || typeof password !== 'string' || await hash(password) !== await hash(expected)) {
      throw new HttpError(401, 'パスワードが違います。');
    }
    await db.prepare("INSERT INTO sessions(hash,user_id,role,expires_at) VALUES(?,?,'operator',?)")
      .bind(tokenHash,crypto.randomUUID(),now+12*3600000).run();
    return response({ok:true,role:'operator'},200,{'Set-Cookie':cookie(request,token,12*3600,'staff')});
  }
  const inviteHash=await hash(typeof b.key==='string' ? b.key : '');
  const results=await db.batch([
    db.prepare("INSERT INTO sessions(hash,user_id,role,table_id,expires_at) SELECT ?,?,role,table_id,? FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>? AND (role<>'dealer' OR EXISTS(SELECT 1 FROM game_tables WHERE id=invites.table_id AND archived_at IS NULL))").bind(tokenHash,crypto.randomUUID(),now+12*3600000,inviteHash,now),
    db.prepare("UPDATE invites SET used_at=? WHERE hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM sessions WHERE hash=?)").bind(now,inviteHash,tokenHash),
  ]);
  if(!results[0].meta.changes) throw new HttpError(401,"コードが違うか、有効期限が切れています。");
  return response({ok:true},200,{'Set-Cookie':cookie(request,token,12*3600,'staff')});
}
async function join(request:Request,b:Record<string,unknown>) {
  const db=database(), now=Date.now(), op=operationId(b);
  const proxy=b.proxy===true;
  const s=await session(request,proxy?'staff':'player');
  if(proxy) { if(!s) throw new HttpError(401,"ログインしてください。"); requireRole(s,['admin','reception','operator']); }
  if(!s) throw new HttpError(401,"画面を更新して受付をやり直してください。");
  if(await replay(op,s)) return response({ok:true},200);
  const kind=b.kind; if(kind!=='beginner' && kind!=='expert') throw new HttpError(400,"卓の種別を選んでください。");
  if (!proxy && (typeof b.nickname !== 'string' || !b.nickname.trim())) {
    throw new HttpError(400, 'ニックネームを入力してください。');
  }
  const nickname=typeof b.nickname==='string' && b.nickname.trim() ? text(b.nickname) : `ゲスト${Math.floor(Math.random()*900+100)}`;
  const player=proxy ? 'proxy-'+crypto.randomUUID() : s.user_id;
  const insert=db.prepare(`INSERT INTO tickets(player_id,day,nickname,kind,queued_at,created_at,fee,minutes,initial_chips,last_op) SELECT ?,?,?,?,?,?,fee,minutes,chips,? FROM settings WHERE id=1 AND ${kind==='beginner'?'beginner_open':'expert_open'}=1 AND EXISTS(SELECT 1 FROM game_tables WHERE kind=? AND archived_at IS NULL) AND (SELECT COUNT(*) FROM tickets WHERE status IN ('waiting','called','seated','playing','hold'))<250`).bind(player,dayKey(now),nickname,kind,now,now,op,kind);
  const results=await db.batch([insert,db.prepare("INSERT INTO operations(id,actor,action,ticket_id,created_at) SELECT ?,?,'join',id,? FROM tickets WHERE last_op=?").bind(op,s.user_id,now,op)]);
  if(!results[0].meta.changes) throw new HttpError(409,"現在この種別の受付を停止しています。");
  return response({ok:true},201);
}
async function mutate(request:Request,b:Record<string,unknown>) {
  const db=database();
  const s=b.scope==='player'?await session(request,'player'):b.scope==='staff'?await session(request,'staff'):(await session(request,'staff')??await session(request,'player'));
  if(!s) throw new HttpError(401,"ログインしてください。");
  const op=operationId(b); if(await replay(op,s)) return response({ok:true,replayed:true});
  const id=integer(b.id,1,10000000), version=integer(b.version,0,10000000);
  const t=await db.prepare("SELECT * FROM tickets WHERE id=?").bind(id).first<Ticket>();
  if(!t) throw new HttpError(404,"受付が見つかりません。");
  if(t.version!==version) throw new HttpError(409,"他の端末で更新されています。最新の状態を確認してください。");
  const action=text(b.action), now=Date.now(); let changes:Record<string,string|number|null>={}, payment=0, paymentType='';
  let correctionTable: GameTable | null = null;
  if(s.role==='player') { if(t.player_id!==s.user_id || action!=='cancel') throw new HttpError(403,"この受付を変更できません。"); }
  else if(s.role==='dealer' && t.table_id!==s.table_id) throw new HttpError(403,"担当卓以外は操作できません。");
  const state=(allowed:string[])=>{if(!allowed.includes(t.status)) throw new HttpError(409,"現在の状態では実行できません。");};
  if(action==='set-status') {
    requireRole(s,['admin','reception','operator']);
    const nickname = b.nickname === undefined ? t.nickname : text(b.nickname);
    const kind = b.kind === undefined ? t.kind : b.kind;
    if (kind !== 'beginner' && kind !== 'expert') throw new HttpError(400, '種別を選んでください。');
    const kindChanged = kind !== t.kind;
    const needsNewSeat = kindChanged && (t.status === 'playing' || t.status === 'seated');
    if (b.status !== t.status || b.table !== undefined || b.seat !== undefined || needsNewSeat || (!kindChanged && nickname === t.nickname)) {
      const correction = await statusCorrection({...t, kind},b,s,now);
      changes = correction.changes;
      correctionTable = correction.table;
    }
    if (nickname !== t.nickname) changes.nickname = nickname;
    if (kindChanged) {
      changes.kind = kind;
      if (t.status === 'called' && b.status === 'called') Object.assign(changes, {table_id:null, seat:null});
    }
  } else if(action==='call') {
    requireRole(s,['admin','reception','operator']); state(['waiting']);
    changes={status:'called',table_id:null,seat:null,called_at:now};
  } else if(action==='pay') {
    requireRole(s,['admin','reception','operator']); state(['called']); if(t.paid) throw new HttpError(409,"すでに入金済みです。");
    changes={paid:1,table_id:null,seat:null}; payment=t.fee; paymentType='payment';
  } else if(action==='seat') {
    requireRole(s,['admin','reception','operator']); state(['called']); if(!t.paid) throw new HttpError(409,"先に支払いを登録してください。");
    if (b.auto === true || (b.table === undefined && t.table_id === null)) return await autoSeatTicket(t, s, op, now);
    const table=await db.prepare("SELECT * FROM game_tables WHERE id=?").bind(text(b.table ?? t.table_id)).first<GameTable>();
    const seat=integer(b.seat ?? t.seat,1,table?.seat_count ?? 9);
    const keepsSeat=t.table_id===table?.id && t.seat===seat;
    if(!table || table.archived_at!==null || table.kind!==t.kind || table.paused_at || (table.assignment_locked && !keepsSeat)) throw new HttpError(409,"ロック・一時停止されていない、対象の一致する卓を選んでください。");
    correctionTable=table;
    changes={status:'seated',table_id:table.id,seat};
  } else if(action==='move-seat') {
    requireRole(s,['admin','dealer','operator']); state(['seated','playing']);
    const table=await db.prepare("SELECT * FROM game_tables WHERE id=? AND archived_at IS NULL").bind(t.table_id).first<GameTable>();
    if(!table || !t.paid) throw new HttpError(409,"移動できる座席ではありません。");
    const seat=integer(b.seat,1,table.seat_count);
    if(seat===t.seat) throw new HttpError(409,"別の空席を選んでください。");
    if(await db.prepare("SELECT id FROM tickets WHERE table_id=? AND seat=? AND status IN ('called','seated','playing')").bind(table.id,seat).first()) throw new HttpError(409,"その席は使用中です。空席を選んでください。");
    correctionTable=table;
    changes={seat};
  } else if(action==='start') {
    requireRole(s,['admin','dealer','operator']); state(['seated']); if(!t.paid) throw new HttpError(409,"未入金のため開始できません。");
    changes={status:'playing',started_at:now,ends_at:now+t.minutes*60000};
  } else if(action==='adjust-time') {
    requireRole(s,['admin','dealer','operator']); state(['playing']);
    const seconds=integer(b.seconds,0,180*60);
    const table=await db.prepare("SELECT * FROM game_tables WHERE id=? AND archived_at IS NULL").bind(t.table_id).first<GameTable>();
    if(!table) throw new HttpError(409,"テーブルの状態を確認してください。");
    correctionTable=table;
    changes={ends_at:(table.paused_at??now)+seconds*1000};
  } else if(action==='finish') {
    requireRole(s,['admin','dealer','operator']); state(['playing']);
    const table=await db.prepare("SELECT paused_at FROM game_tables WHERE id=?").bind(t.table_id).first<{paused_at:number|null}>();
    changes={status:'finished',finished_at:now,final_chips:integer(b.score,0,10000000),paused_ms:t.paused_ms+(table?.paused_at ? now-table.paused_at : 0)};
  } else if(action==='correct') {
    requireRole(s,['admin']); state(['finished']); text(b.reason,200); changes={final_chips:integer(b.score,0,10000000)};
  } else if(action==='reentry') {
    // A busted player buys a new stack during the same slot. The time is not
    // extended; the fee is recorded as its own payment so the revenue includes it.
    requireRole(s,['admin','reception','operator']); state(['playing']); if(!t.paid) throw new HttpError(409,"未入金のためリエントリーできません。");
    const terms=reentryTerms(await getSettings(),t.kind);
    if(b.fee!==undefined && b.fee!==terms.fee) throw new HttpError(409,"リエントリーの料金が変更されました。最新の状態を確認してください。");
    const count=t.reentry_count+1;
    changes={reentry_count:count,reentry_chips:t.reentry_chips+terms.chips}; payment=terms.fee; paymentType='reentry-'+count;
  } else if(action==='hold') {
    requireRole(s,['admin','reception','operator']); state(['called']); if(t.paid) throw new HttpError(409,"入金済みの受付は責任者が返金・取消してください。");
    if(now-(t.called_at ?? now)<180000) throw new HttpError(409,"呼び出しから3分経過後に不在を確定できます。");
    changes={status:'hold',table_id:null,seat:null};
  } else if(action==='requeue') {
    requireRole(s,['admin','reception','operator']); state(['hold']); changes={status:'waiting',queued_at:now,called_at:null,table_id:null,seat:null};
  } else if(action==='cancel') {
    if(s.role!=='player') requireRole(s,['admin','reception','operator']); state(['waiting','called','hold']);
    if(t.paid) throw new HttpError(409,"入金済みの受付は責任者が返金・取消してください。"); changes={status:'cancelled',table_id:null,seat:null};
  } else if(action==='refund') {
    requireRole(s,['admin']); state(['called','seated']); if(!t.paid) throw new HttpError(409,"入金がありません。"); text(b.reason,200);
    changes={status:'cancelled',paid:0,table_id:null,seat:null}; payment=-t.fee; paymentType='refund';
  } else throw new HttpError(400,"不明な操作です。");
  const returnsToFront=t.status==='hold' && changes.status==='waiting';
  const final={...t,...changes,version:version+1,last_op:op};
  const extra=action==='start' ? ' AND EXISTS(SELECT 1 FROM game_tables WHERE id=? AND paused_at IS NULL AND archived_at IS NULL AND kind=? AND seat_count>=?)' : action==='move-seat' ? " AND NOT EXISTS(SELECT 1 FROM tickets occupied WHERE occupied.table_id=? AND occupied.seat=? AND occupied.status IN ('called','seated','playing'))" : '';
  const movingPlaying = action === 'set-status' && t.status === 'playing' && changes.status === undefined && changes.table_id !== undefined;
  const sourceGuard = movingPlaying ? ' AND EXISTS(SELECT 1 FROM game_tables WHERE id=tickets.table_id AND paused_at IS NULL AND archived_at IS NULL)' : '';
  const correctionGuard=correctionTable?' AND EXISTS(SELECT 1 FROM game_tables WHERE id=? AND version=? AND archived_at IS NULL)':'';
  const args=[...Object.values(changes),version+1,op,id,version,...(action==='start' ? [t.table_id,t.kind,t.seat] : action==='move-seat' ? [t.table_id,changes.seat] : []),...(correctionTable?[correctionTable.id,correctionTable.version]:[])];
  // Choose the front position in the write itself, so concurrent returns do not
  // share a stale queue position. Beginner and expert queues remain independent.
  const assignments=Object.keys(changes).map(k=>k==='queued_at' && returnsToFront
    ? "queued_at=COALESCE((SELECT MIN(q.queued_at)-1 FROM tickets q WHERE q.status='waiting' AND q.kind=tickets.kind),?)"
    : `${k}=?`).join(',');
  const statements=[db.prepare(`UPDATE tickets SET ${assignments},version=?,last_op=? WHERE id=? AND version=?${extra}${correctionGuard}${sourceGuard}`).bind(...args)];
  if(paymentType) statements.push(db.prepare("INSERT INTO payments(id,ticket_id,amount,type,created_at,actor) SELECT ?,id,?,?,?,? FROM tickets WHERE id=? AND last_op=?").bind(op,payment,paymentType,now,s.user_id,id,op));
  statements.push(db.prepare("INSERT INTO operations(id,actor,action,ticket_id,before_json,after_json,reason,created_at) SELECT ?,?,?,id,?,json_set(?, '$.queued_at', queued_at),?,? FROM tickets WHERE id=? AND last_op=?").bind(op,s.user_id,action,JSON.stringify(t),JSON.stringify(final),typeof b.reason==='string'?b.reason:null,now,id,op));
  const result=await db.batch(statements); if(!result[0].meta.changes) throw new HttpError(409,"状態が更新されました。最新の状態を確認してください。");
  return response({ok:true});
}
async function tableAction(request:Request,b:Record<string,unknown>) {
  const s=await requireStaff(request); requireRole(s,['admin','dealer','operator']); const db=database(), op=operationId(b);
  if(await replay(op,s)) return response({ok:true});
  const id=text(b.table); if(s.role==='dealer' && s.table_id!==id) throw new HttpError(403,"担当卓以外は操作できません。");
  const t=await db.prepare("SELECT * FROM game_tables WHERE id=? AND archived_at IS NULL").bind(id).first<GameTable>(); if(!t) throw new HttpError(404,"卓がありません。");
  if(t.version!==b.version) throw new HttpError(409,"卓の状態が変わっています。");
  const now=Date.now(), action=t.paused_at?'resume':'pause', statements:D1PreparedStatement[]=[];
  if(t.paused_at) statements.push(db.prepare("UPDATE tickets SET ends_at=ends_at+?,paused_ms=paused_ms+?,version=version+1 WHERE table_id=? AND status='playing' AND EXISTS(SELECT 1 FROM game_tables WHERE id=? AND version=?)").bind(now-t.paused_at,now-t.paused_at,id,id,t.version));
  statements.push(db.prepare("UPDATE game_tables SET paused_at=?,version=version+1,last_op=? WHERE id=? AND version=?").bind(t.paused_at?null:now,op,id,t.version));
  statements.push(db.prepare("INSERT INTO operations(id,actor,action,before_json,after_json,created_at) SELECT ?,?,?,?,?,? FROM game_tables WHERE id=? AND last_op=?").bind(op,s.user_id,action,JSON.stringify(t),JSON.stringify({table:id,at:now}),now,id,op));
  const results=await db.batch(statements);
  if(!results[results.length-2].meta.changes) throw new HttpError(409,"卓の状態が変わっています。");
  return response({ok:true});
}
async function settingsAction(request:Request,b:Record<string,unknown>) {
  const s=await requireStaff(request); requireRole(s,['admin','operator']); const db=database(), op=operationId(b); if(await replay(op,s)) return response({ok:true});
  const before=await getSettings();
  const eventName=b.event_name===undefined?before.event_name:text(b.event_name,MAX_EVENT_TITLE_LENGTH);
  const minutes=integer(b.minutes,1,180);
  await db.batch([
    db.prepare("UPDATE settings SET event_name=?,fee=?,minutes=?,chips=?,beginner_open=COALESCE(?,beginner_open),expert_open=COALESCE(?,expert_open),reentry_fee_beginner=COALESCE(?,reentry_fee_beginner),reentry_fee_expert=COALESCE(?,reentry_fee_expert),reentry_chips_beginner=COALESCE(?,reentry_chips_beginner),reentry_chips_expert=COALESCE(?,reentry_chips_expert) WHERE id=1").bind(eventName,integer(b.fee,0,100000),minutes,integer(b.chips,1,1000000),b.beginner_open===undefined?null:b.beginner_open?1:0,b.expert_open===undefined?null:b.expert_open?1:0,optional(b.reentry_fee_beginner,0,100000),optional(b.reentry_fee_expert,0,100000),optional(b.reentry_chips_beginner,0,1000000),optional(b.reentry_chips_expert,0,1000000)),
    // Shift each existing deadline by its duration difference. This preserves
    // elapsed play and accumulated pauses, including a currently paused table.
    // Update versions in the same transaction so stale start/finish actions fail.
    db.prepare(`UPDATE tickets SET
      ends_at=CASE WHEN status='playing' THEN ends_at+(?-minutes)*60000 ELSE ends_at END,
      minutes=?,version=version+1,last_op=?
      WHERE status IN ('waiting','called','seated','playing','hold') AND minutes<>?
        AND (table_id IS NULL OR EXISTS(SELECT 1 FROM game_tables WHERE id=tickets.table_id AND archived_at IS NULL))`)
      .bind(minutes,minutes,op,minutes),
    db.prepare("INSERT INTO operations(id,actor,action,before_json,after_json,created_at) VALUES(?,?,'settings',?,?,?)").bind(op,s.user_id,JSON.stringify(before),JSON.stringify(b),Date.now())
  ]); return response({ok:true});
}
async function exportCsv(request:Request) {
  const s=await requireStaff(request); requireRole(s,['admin']);
  const saved = await rows<{csv_row: string}>("SELECT csv_row FROM ticket_csv_backup ORDER BY ticket_id");
  const header = ['営業日','受付番号','ニックネーム','種別','状態','卓','席','入金済','料金','開始','予定終了','実際終了','初期チップ','最終チップ','リエントリー回数','リエントリーチップ'];
  const result = [header.map(label => '"' + label + '"').join(','), ...saved.map(row => row.csv_row)].join('\r\n');
  return new Response('\uFEFF'+result,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="festival.csv"','Cache-Control':'no-store'}});
}
export async function handleGet(request:Request) {
  try {
    const path=new URL(request.url).pathname.split('/').at(-1);
    if(path==='export') return await exportCsv(request);
    if(path==='audit') { const s=await requireStaff(request);requireRole(s,['admin']); return response({operations:await rows("SELECT id,actor,action,ticket_id,reason,created_at FROM operations ORDER BY created_at DESC LIMIT 100")}); }
    if(path==='sessions') { const s=await requireStaff(request);requireRole(s,['admin']); return response({sessions:await rows("SELECT user_id,role,table_id,MAX(expires_at) AS expires_at FROM sessions WHERE role<>'player' AND expires_at>? GROUP BY user_id,role,table_id",Date.now())}); }
    return await snapshot(request,path==='staff'||path==='display'||path==='me' ? path : 'public');
  } catch(e) { return failure(e); }
}
export async function handlePost(request:Request) {
  try {
    const b=await payload(request), path=new URL(request.url).pathname.split('/').at(-1);
    if(path==='recovery') return await createRecovery(request,b);
    if(path==='restore') return await recoverVisitor(request,b);
    if(path==='identity') {
      if(await session(request,'player')) return response({ok:true});
      await throttle(request);
      const migratedStaff=await legacyStaffCookie(request);
      const token=randomToken();
      await database().prepare("INSERT INTO sessions(hash,user_id,role,expires_at) VALUES(?,?,'player',?)").bind(await hash(token),crypto.randomUUID(),Date.now()+7*86400000).run();
      const headers=new Headers();
      headers.append('Set-Cookie',cookie(request,token));
      if(migratedStaff) headers.append('Set-Cookie',migratedStaff);
      return response({ok:true},200,headers);
    }
    if(path==='login') return await login(request,b);
    if(path==='join') return await join(request,b);
    if(path==='action') return await mutate(request,b);
    if(path==='table') return await tableAction(request,b);
    if(path==='settings') return await settingsAction(request,b);
    if(path==='table-config') return await configureTable(request,b);
    if(path==='logout') {
      const headers=new Headers({'Set-Cookie':cookie(request,'',0,'staff')});
      for(const scope of ['staff','player'] as const) {
        const token=sessionToken(request,scope);
        if(!token) continue;
        const removed=await database().prepare("DELETE FROM sessions WHERE hash=? AND role<>'player'").bind(await hash(token)).run();
        if(scope==='player' && removed.meta.changes) headers.append('Set-Cookie',cookie(request,'',0));
      }
      return response({ok:true},200,headers);
    }
    if(path==='invite') {
      const s=await requireStaff(request);requireRole(s,['admin']);
      if (staffPassword()) throw new HttpError(409,'スタッフはパスワードでログインしてください。');
      const role=text(b.role);if(!['dealer','reception'].includes(role))throw new HttpError(400,"権限を選んでください。");
      const table=role==='dealer'?text(b.table):null;
      if(table && !await database().prepare('SELECT id FROM game_tables WHERE id=? AND archived_at IS NULL').bind(table).first())throw new HttpError(400,'利用中の卓を選んでください。');
      const key=randomToken();const issued=await database().prepare("INSERT INTO invites(hash,role,table_id,expires_at) SELECT ?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM game_tables WHERE id=? AND archived_at IS NULL)").bind(await hash(key),role,table,Date.now()+3600000,table,table).run();
      if(!issued.meta.changes)throw new HttpError(409,'卓の構成が変わりました。担当卓を選び直してください。');
      return response({key});
    }
    if(path==='revoke') {
      const s=await requireStaff(request);requireRole(s,['admin']);const id=text(b.user,100);if(id==='admin')throw new HttpError(400,"責任者はログアウトで自身の端末を解除できます。");
      await database().prepare("DELETE FROM sessions WHERE user_id=? AND role<>'player'").bind(id).run();return response({ok:true});
    }
    throw new HttpError(404,"操作が見つかりません。");
  } catch(e) { return failure(e); }
}
