import { database } from '../db';
import { cookie, hash, HttpError, legacyStaffCookie, randomToken, requireRole, requireStaff, response, session, sessionToken, throttle } from './auth';

const lifetime=7*86400;
const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function normalizeCode(value:unknown) {
  if(typeof value!=='string' || value.length>64) return null;
  const normalized=value.toUpperCase().replace(/[\s-]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalized)?normalized:null;
}

export async function createRecovery(request:Request,body:Record<string,unknown>) {
  const db=database();
  let playerId:string, token:string|null;
  if(body.ticketId!==undefined) {
    const staff=await requireStaff(request);
    requireRole(staff,['admin','reception']);
    if(typeof body.ticketId!=='number' || !Number.isSafeInteger(body.ticketId) || body.ticketId<1) throw new HttpError(400,'受付番号を確認してください。');
    const ticket=await db.prepare('SELECT player_id FROM tickets WHERE id=?').bind(body.ticketId).first<{player_id:string}>();
    if(!ticket) throw new HttpError(404,'受付が見つかりません。');
    playerId=ticket.player_id;
    token=sessionToken(request,'staff')??sessionToken(request,'player');
  } else {
    const player=await session(request,'player');
    if(!player) throw new HttpError(401,'先に受付画面を開いてください。');
    const ticket=await db.prepare('SELECT id FROM tickets WHERE player_id=? LIMIT 1').bind(player.user_id).first();
    if(!ticket) throw new HttpError(409,'受付が完了すると保存できます。');
    playerId=player.user_id;
    token=sessionToken(request,'player');
  }
  if(!token) throw new HttpError(401,'画面を更新してください。');
  // A stable code per authenticated session avoids rotating a saved link on
  // every refresh. The 12 independent base-32 characters carry 60 random bits.
  const digest=await hash(`player-recovery:${token}:${playerId}`);
  const code=Array.from({length:12},(_,i)=>alphabet[parseInt(digest.slice(i*2,i*2+2),16)&31]).join('');
  const expiresAt=Date.now()+lifetime*1000;
  const result=await db.prepare('INSERT INTO player_recovery(hash,player_id,expires_at) VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET expires_at=excluded.expires_at WHERE player_id=excluded.player_id').bind(await hash(code),playerId,expiresAt).run();
  if(!result.meta.changes) throw new HttpError(409,'保存情報を作成できませんでした。画面を更新してください。');
  return response({recovery:{code:code.match(/.{4}/g)!.join('-'),expiresAt}});
}

export async function recoverVisitor(request:Request,body:Record<string,unknown>) {
  await throttle(request,'recovery');
  const normalized=normalizeCode(body.code);
  const invalid='復帰コードが違うか、有効期限が切れています。保存したコードを確認してください。';
  if(!normalized) throw new HttpError(400,invalid);
  const db=database();
  const recovery=await db.prepare('SELECT player_id FROM player_recovery WHERE hash=? AND expires_at>?').bind(await hash(normalized),Date.now()).first<{player_id:string}>();
  if(!recovery) throw new HttpError(400,invalid);
  const current=await session(request,'player');
  if(current?.user_id===recovery.player_id) return response({ok:true});
  if(current) {
    const active=await db.prepare("SELECT id FROM tickets WHERE player_id=? AND status IN ('waiting','called','seated','playing','hold') LIMIT 1").bind(current.user_id).first();
    if(active) throw new HttpError(409,'このブラウザには別の受付があります。「自分の受付」を確認してください。');
  }
  const staffCookie=await legacyStaffCookie(request);
  const token=randomToken();
  // Recovery grants only the original visitor identity, never a staff role.
  await db.prepare("INSERT INTO sessions(hash,user_id,role,expires_at) VALUES(?,?,'player',?)").bind(await hash(token),recovery.player_id,Date.now()+lifetime*1000).run();
  const headers=new Headers({'Set-Cookie':cookie(request,token,lifetime)});
  if(staffCookie) headers.append('Set-Cookie',staffCookie);
  return response({ok:true},200,headers);
}
