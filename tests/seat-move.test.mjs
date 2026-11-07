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

test('座席移動は共有データを更新しタイマー・入金を保持する', async () => {
  const {admin,player,table,id,current,change,action,getTable} = await setup();
  try {
    await action('call'); await action('pay'); await action('seat',{table,seat:1}); await action('start');
    const before=await current();
    const op=crypto.randomUUID();
    const body={scope:'staff',action:'move-seat',id,version:before.version,seat:2,op};
    assert.equal((await admin('action',body)).status,200);
    const after=await current();
    assert.equal(after.seat,2); assert.equal(after.table_id,table);
    for(const key of ['status','paid','fee','minutes','started_at','ends_at','paused_ms','final_chips']) assert.equal(after[key],before[key],key);
    assert.equal((await admin('staff')).data.tickets.find(t=>t.id===id).seat,2);
    assert.equal((await admin('action',body)).status,200);
    assert.equal((await admin('action',{...body,op:crypto.randomUUID(),seat:3})).status,409);
    for(const seat of [0,4,1.5]) assert.equal((await action('move-seat',{seat})).status,400);
    assert.equal((await player('action',{scope:'player',action:'move-seat',id,version:after.version,seat:1})).status,403);
    await admin('table',{table,version:(await getTable()).version});
    const paused=await current();
    assert.equal((await action('move-seat',{seat:3})).status,200);
    assert.equal((await current()).ends_at,paused.ends_at);
    const second=client(); await second('identity',{}); await second('join',{nickname:'移動先競合テスト',kind:'beginner'});
    const other=(await second('me')).data.tickets[0];
    await admin('action',{scope:'staff',action:'call',id:other.id,version:other.version});
    let o=(await second('me')).data.tickets[0]; await admin('action',{scope:'staff',action:'pay',id:o.id,version:o.version});
    await admin('table',{table,version:(await getTable()).version});
    o=(await second('me')).data.tickets[0]; await admin('action',{scope:'staff',action:'seat',id:o.id,version:o.version,table,seat:1});
    assert.equal((await action('move-seat',{seat:1})).status,409);
    assert.equal((await current()).seat,3);
    await action('finish',{score:0});
    o=(await second('me')).data.tickets[0]; await admin('action',{scope:'staff',action:'refund',id:o.id,version:o.version,reason:'移動テスト終了'});
    assert.equal((await action('move-seat',{seat:2})).status,409);
  } finally {
    const t=await current();
    if(t.status==='playing') await action('finish',{score:0});
    const tab=await getTable(); if(tab) assert.equal((await admin('table-config',{action:'archive',table,version:tab.version})).status,200);
  }
});
