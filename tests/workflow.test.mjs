import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base=process.env.TEST_URL??'http://localhost:3000';
let nextClient=1;
function client(initialCookies={}) {
 const cookies=new Map(Object.entries(initialCookies));
 const ip=`198.51.100.${nextClient++}`;
 const call=async(path,body)=>{
  const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,Cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},body:body?JSON.stringify({op:crypto.randomUUID(),...body}):undefined});
  const setCookies=r.headers.getSetCookie();
  for(const value of setCookies) {
   const pair=value.split(';')[0], separator=pair.indexOf('='), name=pair.slice(0,separator), token=pair.slice(separator+1);
   if(/;\s*Max-Age=0(?:;|$)/i.test(value)) cookies.delete(name);
   else cookies.set(name,token);
  }
  return {status:r.status,data:await r.json(),setCookies};
 };
 call.cookies=cookies;
 return call;
}
test('受付→会計→個人計時→点数確定、権限・二重入金・席競合',async()=>{
 const staff=client(),player=client(),other=client(),anonymous=client();
 assert.equal((await anonymous('staff')).status,401);
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
 assert.equal((await staff('login',{key})).status,200);
 assert.equal((await player('identity',{})).status,200);
 assert.equal((await player('join',{nickname:'動作確認ゲスト',kind:'beginner'})).status,201);
 let mine=(await player('me')).data.tickets[0];
 assert.equal((await player('join',{nickname:'重複登録',kind:'expert'})).status,409);
 await other('identity',{}); assert.equal((await other('me')).data.tickets.length,0);
 assert.equal((await other('action',{action:'cancel',id:mine.id,version:mine.version})).status,403);
 assert.equal((await anonymous('public')).data.tickets.length,0);
 const change=async(action,extra={})=>{mine=(await player('me')).data.tickets[0];return staff('action',{action,id:mine.id,version:mine.version,...extra});};
 assert.equal((await change('call')).status,200);
 assert.equal((await change('seat')).status,409);
 mine=(await player('me')).data.tickets[0];const pay={op:crypto.randomUUID(),action:'pay',id:mine.id,version:mine.version};
 const before=(await staff('staff')).data.revenue;
 assert.equal((await staff('action',pay)).status,200);assert.equal((await staff('action',pay)).status,200);
 assert.equal((await staff('staff')).data.revenue-before,mine.fee);
 assert.equal((await change('seat',{table:'B',seat:1})).status,200);assert.equal((await change('start')).status,200);
 mine=(await player('me')).data.tickets[0];assert.equal(mine.ends_at-mine.started_at,30*60000);
 let table=(await staff('staff')).data.tables.find(t=>t.id==='B');
 assert.equal((await staff('table',{table:'B',version:table.version})).status,200);
 table=(await staff('staff')).data.tables.find(t=>t.id==='B');assert.ok(table.paused_at);
 assert.equal((await staff('table',{table:'B',version:table.version})).status,200);
 assert.equal((await change('finish')).status,200);
 mine=(await player('me')).data.tickets[0];assert.equal(mine.status,'finished');assert.equal(mine.final_chips,null);
 assert.equal((await staff('action',{action:'correct',id:mine.id,version:mine.version,score:0,reason:'点数を後から記録'})).status,200);
 mine=(await player('me')).data.tickets[0];assert.equal(mine.final_chips,0);
 const invite=(await staff('invite',{role:'dealer',table:'A'})).data.key;
 const dealer=client();assert.equal((await dealer('login',{key:invite})).status,200);assert.equal((await client()('login',{key:invite})).status,401);
 assert.equal((await dealer('settings',{fee:500,minutes:30,chips:1000,beginner_open:true,expert_open:true})).status,403);
 assert.equal((await dealer('action',{action:'correct',id:mine.id,version:mine.version,score:5,reason:'test'})).status,403);
 await other('join',{nickname:'座席競合チェック',kind:'beginner'});
 await player('join',{nickname:'再参加チェック',kind:'beginner'});
 for(const c of [player,other]) for(const action of ['call','pay']) {const t=(await c('me')).data.tickets[0];assert.equal((await staff('action',{scope:'staff',action,id:t.id,version:t.version})).status,200);}
 const a=(await player('me')).data.tickets[0], b=(await other('me')).data.tickets[0];
 const result=await Promise.all([staff('action',{action:'seat',id:a.id,version:a.version,table:'C',seat:9}),staff('action',{action:'seat',id:b.id,version:b.version,table:'C',seat:9})]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 for(const c of [player,other]){const t=(await c('me')).data.tickets[0];await staff('action',{scope:'staff',action:'refund',reason:'テスト終了',id:t.id,version:t.version});}
});

test('同じブラウザで通常受付・スタッフ操作・旧セッション移行を両立する',async()=>{
 const browser=client();
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
 assert.equal((await browser('identity',{})).status,200);
 assert.equal((await browser('join',{nickname:'同一ブラウザ確認',kind:'beginner'})).status,201);
 const original=(await browser('me')).data;
 assert.equal((await browser('login',{key})).status,200);
 assert.equal((await browser('staff')).data.me.role,'admin');
 assert.equal((await browser('me')).data.me.user_id,original.me.user_id);
 assert.equal((await browser('me')).data.tickets[0].id,original.tickets[0].id);
 assert.equal((await browser('identity',{})).status,200);
 assert.equal((await browser('me')).data.me.user_id,original.me.user_id);

 // Explicit visitor actions must use the visitor's identity even with admin cookies.
 let own=(await browser('me')).data.tickets[0];
 assert.equal((await browser('action',{scope:'player',action:'call',id:own.id,version:own.version,table:'B',seat:2})).status,403);
 assert.equal((await browser('action',{scope:'player',action:'cancel',id:own.id,version:own.version})).status,200);
 assert.equal((await browser('join',{nickname:'スタッフ受付',kind:'expert'})).status,201);
 assert.equal((await browser('join',{nickname:'二重受付',kind:'expert'})).status,409);
 own=(await browser('me')).data.tickets[0];
 assert.equal((await browser('staff')).data.me.role,'admin');

 assert.equal((await browser('join',{nickname:'代理受付も維持',kind:'beginner',proxy:true})).status,201);
 const proxy=(await browser('staff')).data.tickets.find(t=>t.nickname==='代理受付も維持'&&t.status==='waiting');
 assert.ok(proxy);
 assert.equal((await browser('action',{scope:'player',action:'cancel',id:proxy.id,version:proxy.version})).status,403);
 assert.equal((await browser('action',{scope:'staff',action:'cancel',id:proxy.id,version:proxy.version})).status,200);

 assert.equal((await browser('logout',{})).status,200);
 assert.equal((await browser('staff')).status,401);
 assert.equal((await browser('me')).data.tickets[0].id,own.id);
 assert.equal((await browser('action',{scope:'staff',action:'cancel',id:own.id,version:own.version})).status,401);
 assert.equal((await browser('login',{key})).status,200);
 assert.equal((await browser('me')).data.tickets[0].id,own.id);

 // Simulate a browser logged in before staff and visitor cookies were separated.
 const legacy=client({festival_session:browser.cookies.get('festival_staff_session')});
 const before=(await legacy('staff')).data.me;
 assert.equal(before.role,'admin');
 assert.equal((await legacy('me')).data.me,null);
 const migrated=await legacy('identity',{});
 assert.equal(migrated.status,200);
 assert.equal(migrated.setCookies.length,2);
 assert.ok(migrated.setCookies.every(value=>value.includes('HttpOnly')&&value.includes('SameSite=Strict')));
 assert.equal((await legacy('staff')).data.me.expires_at,before.expires_at);
 assert.equal((await legacy('me')).data.me.role,'player');
 assert.notEqual((await legacy('me')).data.me.user_id,original.me.user_id);
 assert.equal((await legacy('join',{nickname:'旧スタッフ受付',kind:'beginner'})).status,201);
 const migratedTicket=(await legacy('me')).data.tickets[0];
 assert.equal((await legacy('action',{scope:'player',action:'cancel',id:own.id,version:own.version})).status,403);
 assert.equal((await legacy('logout',{})).status,200);
 assert.equal((await legacy('staff')).status,401);
 assert.equal((await legacy('me')).data.tickets[0].id,migratedTicket.id);
 assert.equal((await legacy('action',{scope:'player',action:'cancel',id:migratedTicket.id,version:migratedTicket.version})).status,200);
 assert.equal((await browser('action',{scope:'player',action:'cancel',id:own.id,version:own.version})).status,200);
});

test('ディーラーの通常受付でも権限を維持し、Cookieの入れ替えで昇格できない',async()=>{
 const admin=client(),dealer=client();
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
 assert.equal((await admin('login',{key})).status,200);
 const invite=(await admin('invite',{role:'dealer',table:'A'})).data.key;
 assert.equal((await dealer('login',{key:invite})).status,200);
 assert.equal((await dealer('identity',{})).status,200);
 assert.equal((await dealer('join',{nickname:'ディーラー本人受付',kind:'beginner'})).status,201);
 const own=(await dealer('me')).data.tickets[0];
 assert.equal((await dealer('staff')).data.me.role,'dealer');
 assert.equal((await dealer('settings',{fee:500,minutes:30,chips:1000,beginner_open:true,expert_open:true})).status,403);
 assert.equal((await dealer('join',{nickname:'権限外の代理受付',kind:'expert',proxy:true})).status,403);
 assert.equal((await dealer('action',{scope:'staff',action:'cancel',id:own.id,version:own.version})).status,403);
 assert.equal((await dealer('action',{scope:'player',action:'cancel',id:own.id,version:own.version})).status,200);

 const forged=client({festival_staff_session:dealer.cookies.get('festival_session')});
 assert.equal((await forged('staff')).status,401);
 const wrongVisitor=client({festival_session:dealer.cookies.get('festival_staff_session')});
 assert.equal((await wrongVisitor('me')).data.me,null);
 assert.equal((await wrongVisitor('join',{kind:'beginner'})).status,401);
 // An invalid dedicated staff cookie must not fall back to a legacy admin session.
 const stale=client({festival_staff_session:'0'.repeat(64),festival_session:admin.cookies.get('festival_staff_session')});
 assert.equal((await stale('staff')).status,401);
 await dealer('logout',{});
 await admin('logout',{});
});

test('Cookieを失っても復帰コードで同じ受付に戻り、別の受付は上書きしない',async()=>{
 const player=client(),restored=client(),other=client();
 assert.equal((await player('recovery',{})).status,401);
 assert.equal((await player('identity',{})).status,200);
 assert.equal((await player('recovery',{})).status,409);
 assert.equal((await player('join',{nickname:'復帰コード確認',kind:'beginner'})).status,201);
 const original=(await player('me')).data;
 const own=original.tickets[0];
 try {
  const issued=await player('recovery',{});
  assert.equal(issued.status,200);
  const recovery=issued.data.recovery;
  assert.match(recovery.code,/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
  assert.ok(recovery.expiresAt>Date.now()+6*86400000);
  assert.ok(recovery.expiresAt<=Date.now()+7*86400000);
  assert.equal((await player('recovery',{})).data.recovery.code,recovery.code);
  assert.equal((await restored('restore',{code:`B-${own.id}`})).status,400);
  assert.equal((await restored('restore',{code:'ZZZZ-ZZZZ-ZZZZ'})).status,400);
  const result=await restored('restore',{code:recovery.code.toLowerCase().replaceAll('-',' ')});
  assert.equal(result.status,200);
  assert.equal(result.setCookies.length,1);
  assert.match(result.setCookies[0],/festival_session=.*HttpOnly.*SameSite=Strict/);
  let mine=(await restored('me')).data;
  assert.equal(mine.me.user_id,original.me.user_id);
  assert.deepEqual(mine.tickets,original.tickets);
  assert.equal(mine.position,original.position);
  assert.equal((await restored('staff')).status,401);
  assert.equal((await restored('join',{nickname:'復元後の重複',kind:'beginner'})).status,409);
  assert.equal((await restored('restore',{code:recovery.code})).setCookies.length,0);
  assert.equal((await other('identity',{})).status,200);
  assert.equal((await other('join',{nickname:'別の受付を保護',kind:'expert'})).status,201);
  const otherOriginal=(await other('me')).data;
  assert.equal((await other('restore',{code:recovery.code})).status,409);
  assert.equal((await other('me')).data.me.user_id,otherOriginal.me.user_id);
  assert.deepEqual((await other('me')).data.tickets,otherOriginal.tickets);
  assert.equal((await other('recovery',{ticketId:own.id})).status,401);
  assert.equal(JSON.stringify((await client()('public')).data).includes(recovery.code),false);
  assert.equal(JSON.stringify(mine).includes(recovery.code),false);
  mine=(await restored('me')).data;
  assert.equal((await restored('action',{scope:'player',action:'cancel',id:own.id,version:mine.tickets[0].version})).status,200);
  assert.equal((await player('me')).data.tickets[0].status,'cancelled');
 } finally {
  for(const c of [player,other]) {
   const t=(await c('me')).data.tickets[0];
   if(t&&t.status!=='cancelled') await c('action',{scope:'player',action:'cancel',id:t.id,version:t.version});
  }
 }
});

test('受付スタッフが代理受付のリンクを発行でき、復元してもスタッフ権限を移さない',async()=>{
 const admin=client(),reception=client(),dealer=client();
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
 assert.equal((await admin('login',{key})).status,200);
 const receptionKey=(await admin('invite',{role:'reception'})).data.key;
 assert.equal((await reception('login',{key:receptionKey})).status,200);
 const dealerKey=(await admin('invite',{role:'dealer',table:'A'})).data.key;
 assert.equal((await dealer('login',{key:dealerKey})).status,200);
 assert.equal((await admin('recovery',{})).status,401);
 const nickname='リンク再発行確認-'+crypto.randomUUID().slice(0,8);
 assert.equal((await reception('join',{proxy:true,nickname,kind:'beginner'})).status,201);
 const own=(await admin('staff')).data.tickets.find(t=>t.nickname===nickname);
 assert.ok(own);
 try {
  assert.equal((await dealer('recovery',{ticketId:own.id})).status,403);
  assert.equal((await reception('recovery',{ticketId:-1})).status,400);
  assert.equal((await reception('recovery',{ticketId:Number.MAX_SAFE_INTEGER})).status,404);
  const issued=await reception('recovery',{ticketId:own.id});
  assert.equal(issued.status,200);
  const recovery=issued.data.recovery;
  const visitor=client();
  assert.equal((await visitor('restore',{code:recovery.code})).status,200);
  const mine=(await visitor('me')).data;
  assert.equal(mine.me.role,'player');
  assert.equal(mine.me.user_id,own.player_id);
  assert.deepEqual(mine.tickets[0],own);
  assert.equal((await visitor('staff')).status,401);
  assert.equal((await visitor('settings',{fee:0})).status,401);
  assert.equal(JSON.stringify((await reception('staff')).data).includes(recovery.code),false);

  // Dedicated staff login and legacy staff login both survive visitor recovery.
  assert.equal((await admin('restore',{code:recovery.code})).status,200);
  assert.equal((await admin('staff')).data.me.role,'admin');
  assert.equal((await admin('me')).data.tickets[0].id,own.id);
  const legacy=client({festival_session:reception.cookies.get('festival_staff_session')});
  const before=(await legacy('staff')).data.me;
  const migrated=await legacy('restore',{code:recovery.code});
  assert.equal(migrated.status,200);
  assert.equal(migrated.setCookies.length,2);
  assert.equal((await legacy('staff')).data.me.role,'reception');
  assert.equal((await legacy('staff')).data.me.expires_at,before.expires_at);
  assert.equal((await legacy('me')).data.me.role,'player');
  assert.equal((await legacy('me')).data.tickets[0].id,own.id);
  assert.equal((await admin('logout',{})).status,200);
  assert.equal((await admin('me')).data.tickets[0].id,own.id);
 } finally {
  const t=(await reception('staff')).data.tickets.find(t=>t.id===own.id);
  await reception('action',{scope:'staff',action:'cancel',id:t.id,version:t.version});
  await reception('logout',{});
  await dealer('logout',{});
 }
});

test('復帰コードの総当たりと別サイトからの復元要求を拒否する',async()=>{
 const anonymous=client();
 for(let i=0;i<15;i++) assert.equal((await anonymous('restore',{code:'not-a-code'})).status,400);
 assert.equal((await anonymous('restore',{code:'not-a-code'})).status,429);
 for(const path of ['restore','recovery']) {
  const res=await fetch(base+'/api/'+path,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({code:'AAAA-BBBB-CCCC'})});
  assert.equal(res.status,403);
 }
});
