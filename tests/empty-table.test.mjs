import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL;
const isolated = process.env.TEST_ISOLATED === '1' && Boolean(base);
let nextClient = 1;
function client() {
  const cookies = new Map(), ip = `192.0.2.${nextClient++}`;
  return async (path, body) => {
    const res = await fetch(`${base}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: res.status, data: await res.json() };
  };
}
const state = async admin => (await admin('staff')).data;
const ticket = async (admin, id) => (await state(admin)).tickets.find(t => t.id === id);
async function fixture() {
  const admin = client(), tables = [], people = [];
  const key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login', { key })).status, 200);
  const original = (await state(admin)).tables;
  const configure = async (id, action, extra = {}) => {
    const table = (await state(admin)).tables.find(t => t.id === id);
    return admin('table-config', { action, table: id, version: table.version, ...extra });
  };
  const act = async (id, action, extra = {}) => {
    const t = await ticket(admin, id);
    return admin('action', { scope: 'staff', action, id, version: t.version, ...extra });
  };
  for (const table of original) assert.equal((await configure(table.id, 'lock', { locked: true })).status, 200);
  return {
    admin, configure, act,
    async table(name, seats = 3, kind = 'beginner') {
      const result = await admin('table-config', { action: 'create', name, kind, seat_count: seats });
      assert.equal(result.status, 201); tables.push(result.data.table); return result.data.table;
    },
    async person(table, seat, status = 'seated') {
      const t = (await state(admin)).tables.find(t => t.id === table);
      const op = crypto.randomUUID();
      const result = await admin('join', { op, scope: 'staff', proxy: true, kind: t.kind, nickname: `移動テスト${people.length + 1}` });
      assert.equal(result.status, 201);
      const id = (await state(admin)).tickets.find(t => t.last_op === op).id; people.push(id);
      if (status !== 'waiting') {
        assert.equal((await act(id, 'call')).status, 200);
        assert.equal((await act(id, 'pay')).status, 200);
        if (status !== 'called') {
          assert.equal((await act(id, 'seat', { table, seat })).status, 200);
          if (status === 'playing' || status === 'finished') assert.equal((await act(id, 'start')).status, 200);
          if (status === 'finished') assert.equal((await act(id, 'finish', { score: 1234 })).status, 200);
        }
      }
      return id;
    },
    async request(source, assignments) {
      const data = await state(admin);
      return { op: crypto.randomUUID(), action: 'empty', table: source,
        version: data.tables.find(t => t.id === source).version,
        moves: assignments.map(([id, dest, seat]) => ({
          ticket_id: id, ticket_version: data.tickets.find(t => t.id === id).version,
          table_id: dest, table_version: data.tables.find(t => t.id === dest).version, seat,
        })) };
    },
    async cleanup() {
      for (const id of people) {
        const t = await ticket(admin, id);
        if (t.status === 'playing') await act(id, 'finish', { score: 0 });
        else if (t.paid && ['called', 'seated'].includes(t.status)) await act(id, 'refund', { reason: 'テスト終了' });
        else if (['waiting', 'hold'].includes(t.status)) await act(id, 'cancel');
      }
      for (const id of tables) if ((await state(admin)).tables.some(t => t.id === id)) await configure(id, 'archive');
      for (const table of original) await configure(table.id, 'lock', { locked: Boolean(table.assignment_locked) });
    },
  };
}

test('全員を人数の少ない卓へ移動し、時間・入金・履歴を維持する', { skip: !isolated }, async () => {
  const f = await fixture();
  try {
    const source = await f.table('移動元'), destA = await f.table('移動先A'), destB = await f.table('移動先B');
    const wrongKind = await f.table('別タグ', 9, 'expert'), locked = await f.table('ロック卓', 9);
    const archived = await f.table('削除卓', 9);
    await f.configure(locked, 'lock', { locked: true });
    assert.equal((await f.admin('table', { table: destB, version: (await state(f.admin)).tables.find(t => t.id === destB).version })).status, 200);
    await f.configure(archived, 'archive');
    const finished = await f.person(source, 1, 'finished');
    const a = await f.person(source, 1), b = await f.person(source, 2, 'playing'), c = await f.person(source, 3, 'playing');
    const existing = await f.person(destA, 1), unassigned = await f.person(source, null, 'called');
    const sourceTable = (await state(f.admin)).tables.find(t => t.id === source);
    assert.equal((await f.admin('table', { table: source, version: sourceTable.version })).status, 200);
    const before = await state(f.admin), auditBefore = (await f.admin('audit')).data.operations;
    const request = await f.request(source, [[a, destB, 1], [b, destA, 2], [c, destB, 2]]);
    const result = await f.admin('table-config', request);
    assert.equal(result.status, 200, JSON.stringify(result));
    const after = await state(f.admin), empty = after.tables.find(t => t.id === source);
    assert.equal(after.occupancy[source], 0);
    assert.equal(empty.assignment_locked, 1); assert.equal(empty.paused_at, null);
    assert.equal(after.revenue, before.revenue); assert.equal(after.total, before.total);
    for (const move of request.moves) {
      const old = before.tickets.find(t => t.id === move.ticket_id), current = after.tickets.find(t => t.id === move.ticket_id);
      for (const [key, value] of Object.entries(old)) {
        if (!['table_id', 'seat', 'version', 'last_op', 'ends_at', 'paused_ms'].includes(key)) assert.equal(current[key], value, key);
      }
      assert.equal(current.table_id, move.table_id); assert.equal(current.seat, move.seat);
      assert.equal(current.version, old.version + 1);
      if (old.status === 'playing') {
        const pauseAt = before.tables.find(t => t.id === source).paused_at;
        assert.equal(current.ends_at - old.ends_at, current.paused_ms - old.paused_ms);
        // The remaining time at transfer is precisely the time frozen at pause.
        const destinationPause = after.tables.find(t => t.id === move.table_id).paused_at;
        const destinationClock = destinationPause ?? pauseAt + current.paused_ms - old.paused_ms;
        assert.equal(current.ends_at - destinationClock, old.ends_at - pauseAt);
      } else { assert.equal(current.ends_at, old.ends_at); assert.equal(current.paused_ms, old.paused_ms); }
    }
    for (const id of [finished, existing, unassigned]) assert.deepEqual(after.tickets.find(t => t.id === id), before.tickets.find(t => t.id === id));
    for (const id of [wrongKind, locked, destB]) assert.deepEqual(after.tables.find(t => t.id === id), before.tables.find(t => t.id === id));
    const audit = (await f.admin('audit')).data.operations;
    const entry = audit.find(o => o.id === request.op);
    assert.equal(entry.action, 'table_empty');
    assert.match(entry.reason, /3人を他の卓へ移動/);
    assert.equal(audit.length, Math.min(100, auditBefore.length + 1));
    assert.equal((await f.admin('table-config', request)).status, 200);
    assert.deepEqual((await state(f.admin)).tickets, after.tickets);
    const pausedDestination = after.tables.find(t => t.id === destB);
    assert.equal((await f.admin('table', { table: destB, version: pausedDestination.version })).status, 200);
    const frozen = after.tickets.find(t => t.id === c), resumed = await ticket(f.admin, c);
    const resumedAt = pausedDestination.paused_at + resumed.paused_ms - frozen.paused_ms;
    assert.equal(resumed.ends_at - resumedAt, frozen.ends_at - pausedDestination.paused_at);
    // Locked source cannot receive another guest, and the empty table can be deleted.
    assert.equal((await f.act(unassigned, 'seat', { table: source, seat: 1 })).status, 409);
    assert.equal((await f.configure(source, 'archive')).status, 200);
  } finally { await f.cleanup(); }
});

test('空席不足・変更済みのプレビュー・不正な移動先・権限不足では一人も移動しない', { skip: !isolated }, async () => {
  const f = await fixture();
  try {
    const source = await f.table('確認用移動元', 2), dest = await f.table('確認用移動先', 1);
    const locked = await f.table('確認用ロック卓', 9), paused = await f.table('確認用停止卓', 9);
    const wrongKind = await f.table('確認用別タグ', 9, 'expert');
    await f.configure(locked, 'lock', { locked: true });
    await f.admin('table', { table: paused, version: (await state(f.admin)).tables.find(t => t.id === paused).version });
    await f.configure(paused, 'lock', { locked: true });
    const a = await f.person(source, 1), b = await f.person(source, 2);
    let before = await state(f.admin);
    const shortage = await f.admin('table-config', await f.request(source, [[a, dest, 1], [b, dest, 2]]));
    assert.equal(shortage.status, 409); assert.match(shortage.data.error, /あと1席/);
    assert.deepEqual((await state(f.admin)).tickets, before.tickets);
    assert.deepEqual((await state(f.admin)).tables, before.tables);
    await f.configure(dest, 'update', { name: '確認用移動先', kind: 'beginner', seat_count: 2 });
    const request = await f.request(source, [[a, dest, 1], [b, dest, 2]]);
    for (const table of [source, wrongKind, locked, paused]) {
      const invalid = structuredClone(request); invalid.moves[0].table_id = table;
      assert.equal((await f.admin('table-config', invalid)).status, 409);
    }
    assert.equal((await f.admin('table-config', { ...request, moves: request.moves.slice(0, 1) })).status, 409);
    const reception = client(), dealer = client();
    for (const [role, caller] of [['reception', reception], ['dealer', dealer]]) {
      const invite = await f.admin('invite', { role, table: source });
      assert.equal((await caller('login', { key: invite.data.key })).status, 200);
      assert.equal((await caller('table-config', request)).status, 403);
    }
    // Neither a stale source ticket nor a changed destination may be moved.
    await f.act(a, 'start');
    assert.equal((await f.admin('table-config', request)).status, 409);
    const updatedRequest = await f.request(source, [[a, dest, 1], [b, dest, 2]]);
    await f.configure(dest, 'lock', { locked: true });
    before = await state(f.admin);
    assert.equal((await f.admin('table-config', updatedRequest)).status, 409);
    assert.deepEqual((await state(f.admin)).tickets, before.tickets);
    assert.deepEqual((await state(f.admin)).tables, before.tables);
  } finally { await f.cleanup(); }
});

test('同時に卓を空にしても、席が重複せず全員移動か全員据え置きになる', { skip: !isolated }, async () => {
  const f = await fixture();
  try {
    const sourceA = await f.table('競合元A', 2), sourceB = await f.table('競合元B', 2), dest = await f.table('競合先', 2);
    const a = await f.person(sourceA, 1, 'playing'), b = await f.person(sourceA, 2);
    const c = await f.person(sourceB, 1), d = await f.person(sourceB, 2);
    await f.configure(sourceA, 'lock', { locked: true }); await f.configure(sourceB, 'lock', { locked: true });
    const reqA = await f.request(sourceA, [[a, dest, 1], [b, dest, 2]]);
    const reqB = await f.request(sourceB, [[c, dest, 1], [d, dest, 2]]);
    const before = await state(f.admin);
    const results = await Promise.all([f.admin('table-config', reqA), f.admin('table-config', reqB)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const after = await state(f.admin);
    assert.equal(after.occupancy[dest], 2);
    const winningA = results[0].status === 200;
    assert.equal(after.occupancy[winningA ? sourceA : sourceB], 0);
    assert.equal(after.occupancy[winningA ? sourceB : sourceA], 2);
    for (const id of winningA ? [c, d] : [a, b]) assert.deepEqual(after.tickets.find(t => t.id === id), before.tickets.find(t => t.id === id));
    // Running timers are not restarted by an unpaused transfer.
    if (winningA) assert.equal(after.tickets.find(t => t.id === a).ends_at, before.tickets.find(t => t.id === a).ends_at);
    const winningRequest = winningA ? reqA : reqB;
    const replays = await Promise.all([f.admin('table-config', winningRequest), f.admin('table-config', winningRequest)]);
    assert.ok(replays.every(r => r.status === 200));
    assert.deepEqual((await state(f.admin)).tickets, after.tickets);
  } finally { await f.cleanup(); }
});
