import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL;
const isolated = process.env.TEST_ISOLATED === '1' && Boolean(base);

test('時間設定を既存受付と計時中・停止中へ反映し、経過時間と終了記録を保つ', { skip: !isolated }, async () => {
  let cookie = '';
  const call = async (path, body) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined,
    });
    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
  const ok = async (path, body, status = 200) => {
    const result = await call(path, body);
    assert.equal(result.status, status, JSON.stringify(result.data));
    return result.data;
  };
  const state = () => ok('staff');
  const getTicket = async id => (await state()).tickets.find(t => t.id === id);
  const act = async (id, action, extra = {}) => {
    const ticket = await getTicket(id);
    return ok('action', { scope: 'staff', id, version: ticket.version, action, ...extra });
  };
  const toggle = async id => {
    const table = (await state()).tables.find(t => t.id === id);
    return ok('table', { table: id, version: table.version });
  };
  const key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  await ok('login', { key });
  const original = (await state()).settings;
  const people = [], tables = [];
  try {
    await ok('settings', { ...original, minutes: 30, beginner_open: true });
    for (const name of ['計時確認', '停止確認']) {
      tables.push((await ok('table-config', { action: 'create', name, kind: 'beginner', seat_count: 9 }, 201)).table);
    }
    const person = async (status, table = null, seat = null) => {
      const op = crypto.randomUUID();
      await ok('join', { op, proxy: true, nickname: `時間変更${people.length + 1}`, kind: 'beginner' }, 201);
      const id = (await state()).tickets.find(t => t.last_op === op).id;
      people.push(id);
      if (status === 'cancelled') await act(id, 'cancel');
      else if (status === 'hold') await act(id, 'set-status', { status: 'hold' });
      else if (status !== 'waiting') {
        await act(id, 'call');
        if (status !== 'called') {
          await act(id, 'pay');
          await act(id, 'seat', { table, seat });
          if (status !== 'seated') await act(id, 'start');
          if (status === 'finished') await act(id, 'finish', { score: 1500 });
        }
      }
      return id;
    };
    const waiting = await person('waiting');
    const called = await person('called');
    const hold = await person('hold');
    const seated = await person('seated', tables[0], 1);
    const running = await person('playing', tables[0], 2);
    const paused = await person('playing', tables[1], 1);
    const finished = await person('finished', tables[0], 3);
    const cancelled = await person('cancelled');
    // Exercise an already accumulated pause and an ongoing pause.
    await toggle(tables[0]);
    await toggle(tables[0]);
    await toggle(tables[1]);
    const before = await state();
    const request = { ...before.settings, minutes: 10, op: crypto.randomUUID() };
    await ok('settings', request);
    const after = await state();
    assert.equal(after.settings.minutes, 10);
    assert.equal(after.revenue, before.revenue);
    for (const id of [waiting, called, hold, seated, running, paused]) {
      const old = before.tickets.find(t => t.id === id);
      const changed = after.tickets.find(t => t.id === id);
      assert.equal(changed.minutes, 10);
      assert.equal(changed.version, old.version + 1);
      assert.equal(changed.last_op, request.op);
      assert.equal(changed.ends_at, old.ends_at === null ? null : old.ends_at - 20 * 60_000);
      for (const field of ['status', 'started_at', 'paused_ms', 'paid', 'fee', 'initial_chips', 'table_id', 'seat']) {
        assert.equal(changed[field], old[field], field);
      }
    }
    for (const id of [finished, cancelled]) {
      assert.deepEqual(after.tickets.find(t => t.id === id), before.tickets.find(t => t.id === id));
    }
    const pauseAt = before.tables.find(t => t.id === tables[1]).paused_at;
    assert.equal(after.tables.find(t => t.id === tables[1]).paused_at, pauseAt);
    const oldPaused = before.tickets.find(t => t.id === paused);
    const newPaused = after.tickets.find(t => t.id === paused);
    assert.equal(newPaused.ends_at - pauseAt, oldPaused.ends_at - pauseAt - 20 * 60_000);

    // A stale start must not restore the old duration.
    const stale = before.tickets.find(t => t.id === seated);
    assert.equal((await call('action', { scope: 'staff', action: 'start', id: seated, version: stale.version })).status, 409);
    await ok('settings', request);
    await ok('settings', { ...request, op: crypto.randomUUID() });
    assert.deepEqual((await state()).tickets, after.tickets);
    assert.equal((await call('settings', { ...after.settings, minutes: 0 })).status, 400);
    assert.deepEqual((await state()).tickets, after.tickets);
    assert.equal((await state()).settings.minutes, 10);

    await act(seated, 'start');
    const started = await getTicket(seated);
    assert.equal(started.ends_at - started.started_at, 10 * 60_000);
    await toggle(tables[1]);
    const resumed = await getTicket(paused);
    assert.equal(resumed.ends_at - newPaused.ends_at, resumed.paused_ms - newPaused.paused_ms);
    const beforeExtend = await state();
    await ok('settings', { ...beforeExtend.settings, minutes: 40 });
    const extended = await state();
    for (const id of [running, paused, seated]) {
      const old = beforeExtend.tickets.find(t => t.id === id), current = extended.tickets.find(t => t.id === id);
      assert.equal(current.ends_at, old.ends_at + 30 * 60_000);
      assert.equal(current.started_at, old.started_at);
      assert.equal(current.paused_ms, old.paused_ms);
    }
    const next = await person('waiting');
    assert.equal((await getTicket(next)).minutes, 40);
  } finally {
    for (const id of people) {
      const t = await getTicket(id);
      if (t.status === 'playing') await act(id, 'finish', { score: 0 });
      else if (t.paid && ['called', 'seated'].includes(t.status)) await act(id, 'refund', { reason: '時間設定テスト終了' });
      else if (['waiting', 'called', 'hold'].includes(t.status)) await act(id, 'cancel');
    }
    for (const id of tables) {
      const table = (await state()).tables.find(t => t.id === id);
      await ok('table-config', { action: 'archive', table: id, version: table.version });
    }
    await ok('settings', original);
  }
});
