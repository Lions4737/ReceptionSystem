import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL ?? 'http://127.0.0.1:3000';
let nextClient = 160;
function client() {
  const cookies = new Map(), ip = `198.51.100.${nextClient++}`;
  return async (path, body) => {
    const res = await fetch(`${base}/api/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; ') },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined });
    for (const cookie of res.headers.getSetCookie()) { const [pair] = cookie.split(';'); const split = pair.indexOf('='); cookies.set(pair.slice(0,split),pair.slice(split+1)); }
    return { status: res.status, data: await res.json() };
  };
}
async function setup() {
  const admin = client(), player = client();
  const key = readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login',{key})).status,200);
  const created = await admin('table-config',{action:'create',name:'手動変更テスト卓',kind:'beginner',seat_count:3});
  assert.equal(created.status,201);
  const table = created.data.table;
  await player('identity',{});
  assert.equal((await player('join',{nickname:'とても長い名前の表示とステータス変更を確認するためのゲスト',kind:'beginner'})).status,201);
  const id = (await player('me')).data.tickets[0].id;
  const current = async () => (await player('me')).data.tickets.find(t=>t.id===id);
  const change = async (status, extra={}, actor=admin) => actor('action',{scope:'staff',action:'set-status',id,version:(await current()).version,status,...extra});
  const action = async (name, extra={}) => admin('action',{scope:'staff',action:name,id,version:(await current()).version,...extra});
  const getTable = async () => (await admin('staff')).data.tables.find(t=>t.id===table);
  return {admin,player,table,id,current,change,action,getTable};
}

test('手動変更で席・タイマー・結果を更新し、会計と操作履歴を保持する', async () => {
  const {admin,player,table,id,current,change,action,getTable} = await setup();
  try {
    assert.equal((await change('invalid')).status,400);
    assert.equal((await change('hold',{reason:'x'.repeat(201)})).status,400);
    for(const status of ['seated','playing','finished']) assert.equal((await change(status,{table,seat:1,score:0})).status,409);
    assert.equal((await change('called',{table,seat:4})).status,200);
    assert.equal((await current()).table_id,null); assert.equal((await current()).seat,null);
    assert.equal((await change('hold')).status,200);
    let ticket = await current(); assert.equal(ticket.table_id,null); assert.equal(ticket.seat,null);
    assert.equal((await change('waiting')).status,200);
    assert.equal((await change('called',{table,seat:1})).status,200);
    assert.ok((await admin('public')).data.called.some(t=>t.code.endsWith(String(id).padStart(3,'0'))&&t.table_id===null&&t.seat===null));
    // Manual correction can mark someone absent immediately, unlike the 3-minute normal action.
    assert.equal((await change('hold',{reason:'呼び出しを誤って操作'})).status,200);
    assert.equal((await admin('public')).data.occupancy[table],0);
    assert.equal((await change('called',{table,seat:1})).status,200);
    assert.equal((await action('pay')).status,200);
    const revenue = (await admin('staff')).data.revenue;
    for(const status of ['waiting','hold','cancelled']) assert.equal((await change(status)).status,409);
    assert.equal((await change('seated',{table,seat:1})).status,200);
    assert.equal((await change('playing',{table,seat:1})).status,200);
    ticket=await current(); assert.equal(ticket.ends_at-ticket.started_at,ticket.minutes*60000);
    assert.equal((await change('seated',{table,seat:1})).status,200);
    ticket=await current(); assert.equal(ticket.started_at,null); assert.equal(ticket.ends_at,null);
    const request={op:crypto.randomUUID(),scope:'staff',action:'set-status',id,version:ticket.version,status:'playing',table,seat:1};
    assert.equal((await admin('action',request)).status,200);
    const started=await current();
    assert.equal((await admin('action',request)).status,200);
    assert.deepEqual(await current(),started);
    assert.equal((await change('playing',{nickname:'   '})).status,400);
    assert.equal((await change('playing',{nickname:' 修正した名前 '})).status,200);
    const renamed = await current();
    assert.deepEqual(renamed, {...started, nickname:'修正した名前', version:started.version+1, last_op:renamed.last_op});
    const expert = (await admin('table-config',{action:'create',name:'種別変更テスト卓',kind:'expert',seat_count:2})).data.table;
    assert.equal((await change('playing',{table,seat:2})).status,200);
    assert.equal((await change('playing',{kind:'expert'})).status,409);
    assert.equal((await change('playing',{kind:'expert',table,seat:1})).status,409);
    assert.equal((await change('playing',{kind:'expert',table:expert,seat:1})).status,200);
    const moved = await current();
    assert.equal(moved.kind,'expert');
    assert.equal(moved.table_id,expert);
    assert.equal(moved.seat,1);
    assert.equal(moved.started_at,started.started_at);
    assert.equal(moved.ends_at,started.ends_at);
    assert.equal(moved.paid,started.paid);
    assert.equal((await change('playing',{kind:'beginner',table,seat:2})).status,200);
    const expertTable = (await admin('staff')).data.tables.find(t=>t.id===expert);
    assert.equal((await admin('table-config',{action:'archive',table:expert,version:expertTable.version})).status,200);
    assert.equal((await change('finished',{score:-1})).status,400);
    assert.equal((await change('finished')).status,400);
    assert.equal((await change('finished',{nickname:'最終結果の名前',score:0,reason:'終了に修正'})).status,200);
    ticket=await current(); assert.equal(ticket.final_chips,0); assert.equal(ticket.paid,1);
    assert.equal(ticket.nickname,'最終結果の名前');
    assert.equal((await admin('public')).data.occupancy[table],0);
    assert.equal((await player('join',{nickname:'同じ人の次の受付',kind:'beginner'})).status,201);
    assert.equal((await change('playing',{table,seat:2})).status,409);
    assert.equal((await current()).status,'finished');
    const next=(await player('me')).data.tickets[0];
    assert.equal((await admin('action',{scope:'staff',action:'cancel',id:next.id,version:next.version})).status,200);
    assert.equal((await change('playing',{table,seat:2})).status,200);
    ticket=await current(); assert.equal(ticket.final_chips,null); assert.equal(ticket.finished_at,null);
    let state=await getTable();
    assert.equal((await admin('table',{table,version:state.version})).status,200);
    assert.equal((await change('seated',{table,seat:2})).status,409);
    assert.equal((await action('adjust-time',{seconds:0})).status,200);
    state=await getTable();
    assert.equal((await current()).ends_at,state.paused_at);
    assert.equal((await action('adjust-time',{seconds:90})).status,200);
    const adjusted=await current();
    assert.equal(adjusted.ends_at,state.paused_at+90_000);
    assert.equal(adjusted.started_at,ticket.started_at);
    assert.equal(adjusted.status,'playing');
    assert.equal((await change('finished',{score:1250})).status,200);
    assert.equal((await current()).paid,1);
    assert.equal((await admin('staff')).data.revenue,revenue);
    const log=(await admin('audit')).data.operations.filter(o=>o.ticket_id===id&&o.action==='set-status');
    assert.ok(log.some(o=>o.reason==='終了に修正'));
    assert.ok(log.some(o=>o.reason==='呼び出しを誤って操作'));
  } finally {
    const ticket=await current();
    if(ticket.paid&&ticket.status==='called') await action('refund',{reason:'テスト終了'});
    else if(ticket.paid&&['seated','playing'].includes(ticket.status)) await change('finished',{score:0});
    else if(['waiting','called','hold'].includes(ticket.status)) await action('cancel');
    const state=await getTable(); if(state) await admin('table-config',{action:'archive',table,version:state.version});
    await admin('logout',{});
  }
});

test('手動変更でも権限・席競合・古い更新・返金済み受付の再利用を検証する', async () => {
  const {admin,player,table,id,current,change,action,getTable} = await setup();
  const reception=client(),dealer=client(),other=client();
  try {
    const invite=async(role,actor)=>{const key=(await admin('invite',{role,table})).data.key; assert.equal((await actor('login',{key})).status,200);};
    await invite('reception',reception); await invite('dealer',dealer);
    let ticket=await current();
    assert.equal((await player('action',{scope:'player',action:'set-status',id,version:ticket.version,status:'hold'})).status,403);
    assert.equal((await change('hold',{},dealer)).status,403);
    assert.equal((await change('hold',{},reception)).status,200);
    assert.equal((await change('waiting',{},reception)).status,200);
    ticket=await current();
    const results=await Promise.all([
      admin('action',{scope:'staff',action:'set-status',id,version:ticket.version,status:'called',table,seat:1}),
      admin('action',{scope:'staff',action:'set-status',id,version:ticket.version,status:'hold'}),
    ]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    if((await current()).status!=='called') assert.equal((await change('called',{table,seat:1})).status,200);
    await other('identity',{}); await other('join',{kind:'beginner'});
    assert.equal((await action('pay')).status,200);
    assert.equal((await change('seated',{table,seat:1},reception)).status,200);
    const secondAction=async(action,fields={})=>{const t=(await other('me')).data.tickets[0];return admin('action',{scope:'staff',action,id:t.id,version:t.version,...fields});};
    assert.equal((await secondAction('call')).status,200);
    assert.equal((await secondAction('pay')).status,200);
    assert.equal((await secondAction('set-status',{status:'seated',table,seat:1})).status,409);
    assert.equal((await change('playing',{table,seat:1},reception)).status,409);
    assert.equal((await change('finished',{score:0},reception)).status,409);
    assert.equal((await action('refund',{reason:'テスト返金'})).status,200);
    assert.equal((await change('waiting')).status,409);
    assert.equal((await current()).status,'cancelled');
    assert.equal((await secondAction('refund',{reason:'テスト終了'})).status,200);
    assert.equal((await other('join',{kind:'beginner'})).status,201);
    assert.equal((await secondAction('set-status',{status:'cancelled'})).status,200);
    let last=(await other('me')).data.tickets[0];
    assert.equal((await admin('action',{scope:'staff',action:'set-status',id:last.id,version:last.version,status:'waiting'})).status,200);
    last=(await other('me')).data.tickets[0];
    assert.equal((await admin('action',{scope:'staff',action:'cancel',id:last.id,version:last.version})).status,200);
  } finally {
    const ticket=await current(); if(!ticket.paid&&['waiting','called','hold'].includes(ticket.status)) await action('cancel');
    const state=await getTable(); if(state) await admin('table-config',{action:'archive',table,version:state.version});
    await reception('logout',{}); await dealer('logout',{}); await admin('logout',{});
  }
});
