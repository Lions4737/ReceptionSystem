import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL ?? 'http://127.0.0.1:3000';
let nextClient = 100;
function client() {
  const cookies = new Map(), ip = `198.51.100.${nextClient++}`;
  return async (path, body) => {
    const res = await fetch(`${base}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; ') },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) { const [pair] = cookie.split(';'); const split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    return { status: res.status, data: await res.json() };
  };
}
async function adminClient() {
  const admin = client(), key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login', { key })).status, 200);
  return admin;
}
const getTable = async (admin, id) => { const {data} = await admin('staff'); return [...data.tables, ...(data.archivedTables ?? [])].find(t=>t.id===id); };
async function configure(admin, id, action, extra = {}) {
  const table = await getTable(admin, id);
  return admin('table-config', { action, table: id, version: table.version, ...extra });
}
async function ticketAction(admin, player, action, extra = {}) {
  const ticket = (await player('me')).data.tickets[0];
  return admin('action', { scope: 'staff', action, id: ticket.id, version: ticket.version, ...extra });
}
async function cancel(admin, player) {
  const ticket = (await player('me')).data.tickets[0];
  if (ticket?.paid && ['called','seated'].includes(ticket.status)) assert.equal((await ticketAction(admin, player, 'refund', {reason:'テスト終了'})).status,200);
  else if (ticket && ['waiting','called','hold'].includes(ticket.status) && !ticket.paid) assert.equal((await ticketAction(admin, player, 'cancel')).status, 200);
}

test('テーブルの追加・編集・削除・復元、動的な座席上限と履歴保護', async () => {
  const admin = await adminClient(), player = client(), dealer = client();
  const original = (await admin('staff')).data;
  const request = { op: crypto.randomUUID(), action: 'create', name: '  構成テスト卓  ', kind: 'beginner', seat_count: 3 };
  const created = await admin('table-config', request);
  assert.equal(created.status, 201);
  const id = created.data.table;
  try {
    assert.equal((await admin('table-config', request)).status, 200);
    let state = (await admin('staff')).data;
    assert.equal(state.tables.length, original.tables.length + 1);
    assert.equal(state.tables.find(t=>t.id===id).name, '構成テスト卓');
    assert.equal(state.tables.find(t=>t.id===id).seat_count, 3);
    for (const table of original.tables) assert.deepEqual(state.tables.find(t=>t.id===table.id), table);
    assert.deepEqual(state.tickets, original.tickets);
    for (const invalid of [{name:''},{name:'名'.repeat(31)},{seat_count:0},{seat_count:10},{seat_count:2.5},{kind:'invalid'}]) {
      assert.equal((await configure(admin, id, 'update', { name:'構成テスト卓', kind:'beginner', seat_count:3, ...invalid })).status, 400);
    }
    const stale = await getTable(admin, id);
    assert.equal((await configure(admin, id, 'update', { name:'変更した卓', kind:'beginner', seat_count:2 })).status, 200);
    assert.equal((await admin('table-config', {action:'archive',table:id,version:stale.version})).status, 409);
    assert.equal((await client()('public')).data.tables.find(t=>t.id===id).name, '変更した卓');

    const invite = await admin('invite', { role:'dealer', table:id });
    assert.equal(invite.status, 200);
    assert.equal((await dealer('login', {key:invite.data.key})).status, 200);
    assert.equal((await dealer('table-config', {action:'create',name:'権限外',kind:'expert',seat_count:2})).status, 403);
    assert.equal((await player('identity', {})).status, 200);
    assert.equal((await player('join', {nickname:'構成テスト',kind:'beginner'})).status, 201);
    assert.equal((await ticketAction(admin, player, 'call')).status, 200);
    assert.equal((await ticketAction(admin, player, 'pay')).status, 200);
    assert.equal((await ticketAction(admin, player, 'seat', {table:id,seat:3})).status, 400);
    assert.equal((await ticketAction(admin, player, 'seat', {table:id,seat:2})).status, 200);
    assert.equal((await configure(admin, id, 'archive')).status, 409);
    assert.equal((await configure(admin, id, 'update', {name:'変更した卓',kind:'expert',seat_count:2})).status, 409);
    assert.equal((await configure(admin, id, 'update', {name:'変更した卓',kind:'beginner',seat_count:1})).status, 409);
    assert.equal((await configure(admin, id, 'update', {name:'拡張した卓',kind:'beginner',seat_count:4})).status, 200);
    assert.equal((await ticketAction(dealer, player, 'start')).status, 200);
    const beforePause = (await player('me')).data.tickets[0];
    let table = await getTable(admin, id);
    assert.equal((await dealer('table', {table:id,version:table.version})).status, 200);
    table = await getTable(admin, id);
    assert.ok(table.paused_at);
    assert.equal((await configure(admin, id, 'archive')).status, 409);
    assert.equal((await dealer('table', {table:id,version:table.version})).status, 200);
    assert.ok((await player('me')).data.tickets[0].ends_at >= beforePause.ends_at);
    assert.equal((await ticketAction(dealer, player, 'finish', {score:1250})).status, 200);
    const finished = (await player('me')).data.tickets[0];
    const unusedInvite = (await admin('invite', {role:'dealer',table:id})).data.key;
    assert.equal((await configure(admin, id, 'archive')).status, 200);
    assert.equal((await admin('public')).data.tables.some(t=>t.id===id), false);
    assert.deepEqual((await player('me')).data.tickets[0], finished);
    assert.equal((await admin('invite', {role:'dealer',table:id})).status, 400);
    assert.equal((await client()('login', {key:unusedInvite})).status, 401);
    table = await getTable(admin, id);
    assert.equal((await dealer('table', {table:id,version:table.version})).status, 404);
    assert.equal((await configure(admin, id, 'restore')).status, 200);
    table = await getTable(admin, id);
    assert.equal(table.name, '拡張した卓');
    assert.equal(table.seat_count, 4);
    assert.equal(table.paused_at, null);
    assert.equal((await admin('public')).data.occupancy[id], 0);
    assert.deepEqual((await player('me')).data.tickets[0], finished);
  } finally {
    await cancel(admin, player);
    const table = await getTable(admin, id);
    if (table.archived_at === null && !(await admin('staff')).data.occupancy[id]) await configure(admin, id, 'archive');
    await dealer('logout', {}); await admin('logout', {});
  }
});

test('入金後の割り振りと削除・席数変更が同時でも、利用中の席を失わない', async () => {
  const admin = await adminClient();
  try {
    for (const action of ['archive','update']) {
      const created = await admin('table-config', {action:'create',name:`競合テスト ${action}`,kind:'beginner',seat_count:2});
      assert.equal(created.status, 201);
      const id = created.data.table, player = client();
      try {
        await player('identity', {}); assert.equal((await player('join', {nickname:'同時操作テスト',kind:'beginner'})).status, 201);
        assert.equal((await ticketAction(admin, player, 'call')).status,200);
        assert.equal((await ticketAction(admin, player, 'pay')).status,200);
        const table = await getTable(admin, id), ticket = (await player('me')).data.tickets[0];
        const results = await Promise.all([
          admin('action', {scope:'staff',action:'seat',id:ticket.id,version:ticket.version,table:id,seat:2}),
          admin('table-config', {action,table:id,version:table.version,name:table.name,kind:table.kind,seat_count:1}),
        ]);
        assert.equal(results.filter(r=>r.status===200).length, 1);
        assert.ok(results.every(r=>[200,400,409].includes(r.status)));
        const current = await getTable(admin, id), mine = (await player('me')).data.tickets[0];
        if (mine.status === 'seated') { assert.equal(current.archived_at, null); assert.ok(current.seat_count >= mine.seat); }
        else { assert.equal(mine.status, 'called'); assert.equal(mine.paid,1); assert.equal(mine.table_id,null); }
      } finally {
        await cancel(admin, player);
        if ((await getTable(admin, id)).archived_at === null) await configure(admin, id, 'archive');
      }
    }
  } finally { await admin('logout', {}); }
});

// This scenario intentionally removes every table; only run against a disposable local DB.
test('0卓から再構成でき、待ち時間と受付可否が席数に追従する', {skip:process.env.TEST_ISOLATED !== '1'}, async () => {
  const admin = await adminClient(), original = (await admin('staff')).data.tables, player = client();
  const removed = []; let id;
  try {
    for (const table of original) { assert.equal((await configure(admin, table.id, 'archive')).status, 200); removed.push(table.id); }
    let data = (await admin('public')).data;
    assert.equal(data.tables.length, 0);
    assert.deepEqual(data.waitMinutes, {beginner:null,expert:null});
    await player('identity', {});
    assert.equal((await player('join', {kind:'beginner'})).status, 409);
    assert.equal((await admin('invite', {role:'dealer',table:'A'})).status, 400);
    assert.equal((await fetch(base+'/staff/table')).status, 200);
    const created = await admin('table-config', {action:'create',name:'新しいイベント卓',kind:'expert',seat_count:1});
    assert.equal(created.status, 201); id = created.data.table;
    assert.equal((await player('join', {kind:'expert'})).status, 201);
    assert.equal((await ticketAction(admin, player, 'call', {table:id,seat:1})).status, 200);
    data = (await admin('public')).data;
    assert.equal(data.waitMinutes.expert, data.settings.minutes + 5);
    assert.equal((await configure(admin, id, 'update', {name:'新しいイベント卓',kind:'expert',seat_count:2})).status, 200);
    assert.equal((await admin('public')).data.waitMinutes.expert, 0);
  } finally {
    await cancel(admin, player);
    if (id && (await getTable(admin, id)).archived_at === null) await configure(admin, id, 'archive');
    for (const table of removed) if ((await getTable(admin, table)).archived_at !== null) await configure(admin, table, 'restore');
    await admin('logout', {});
  }
});
