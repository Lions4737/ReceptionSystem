import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL;
const isolated = process.env.TEST_ISOLATED === '1' && Boolean(base);

function client() {
  const cookies = new Map();
  return async (path, body, method) => {
    const res = await fetch(base + path, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { Origin: base, 'Content-Type': 'application/json', Cookie: [...cookies.values()].join('; ') },
      body: body && JSON.stringify({ op: crypto.randomUUID(), ...body }),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      cookies.set(pair.split('=')[0], pair);
    }
    return { status: res.status, data: await res.json() };
  };
}

test('講習・同じ席での種別訂正・点数なし終了・入金保持と返金をイベントごとに検証する', { skip: !isolated }, async () => {
  const admin = client();
  const key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([^"\n]+)"?/)[1];
  assert.equal((await admin('/api/login', { key })).status, 200);
  const slug = 'review-' + crypto.randomUUID(), api = '/event/' + slug + '/api/';
  assert.equal((await admin('/api/events', { slug, name: 'レビュー修正検証' })).status, 201);
  assert.equal((await admin('/api/events', { slug, enabled: true }, 'PATCH')).status, 200);
  const table = (await admin(api + 'table-config', { action: 'create', name: '経験者卓', kind: 'expert', seat_count: 3 })).data.table;
  const player = client();
  await player(api + 'identity', {});
  assert.equal((await player(api + 'join', { nickname: '講習から参加', kind: 'beginner' })).status, 201);
  const current = async () => (await player(api + 'me')).data.tickets[0];
  const action = async (action, fields = {}, actor = admin) => {
    const ticket = await current();
    return actor(api + 'action', { scope: 'staff', action, id: ticket.id, version: ticket.version, ...fields });
  };
  const revenue = async () => (await admin(api + 'staff')).data.revenue;
  assert.equal((await action('call')).status, 200);
  assert.equal((await action('pay')).status, 200);
  assert.equal(await revenue(), 500);
  assert.equal((await action('lecture')).status, 200);
  assert.ok((await current()).lecture_at);
  assert.equal((await admin(api + 'display')).data.called.length, 0);
  assert.equal((await action('seat', { table, seat: 1 })).status, 200);
  assert.equal((await current()).lecture_at, null);

  const beforeSeated = await current();
  assert.equal((await action('set-status', { status: 'seated', kind: 'expert', table, seat: 1 })).status, 200);
  const seated = await current();
  for (const field of ['status', 'table_id', 'seat', 'started_at', 'ends_at', 'paid']) assert.equal(seated[field], beforeSeated[field], field);
  assert.equal(seated.kind, 'expert');
  assert.equal((await action('start')).status, 200);

  const playing = await current();
  const correction = { action: 'set-status', status: 'playing', kind: 'beginner', id: playing.id, version: playing.version, op: crypto.randomUUID(), scope: 'staff', table, seat: 1 };
  assert.equal((await admin(api + 'action', correction)).status, 200);
  const corrected = await current();
  for (const field of ['status', 'table_id', 'seat', 'started_at', 'ends_at', 'paid']) assert.equal(corrected[field], playing[field], field);
  assert.equal(corrected.kind, 'beginner');
  assert.equal((await admin(api + 'action', correction)).status, 200);
  assert.deepEqual(await current(), corrected);
  assert.equal((await admin(api + 'action', { ...correction, op: crypto.randomUUID() })).status, 409);
  // API clients may also omit the unchanged seat when correcting a kind.
  assert.equal((await action('set-status', { status: 'playing', kind: 'expert' })).status, 200);
  assert.equal((await current()).seat, 1);
  assert.equal((await current()).ends_at, playing.ends_at);

  assert.equal((await action('finish')).status, 200);
  assert.equal((await current()).final_chips, null);
  assert.equal((await action('correct', { score: 0, reason: '点数を後から記録' })).status, 200);
  assert.equal((await current()).final_chips, 0);
  assert.equal((await action('correct', { score: null, reason: '点数記録を取り消し' })).status, 200);
  assert.equal((await current()).final_chips, null);
  for (const status of ['waiting', 'hold', 'called']) {
    assert.equal((await action('set-status', { status })).status, 200);
    assert.equal((await current()).paid, 1);
    assert.equal(await revenue(), 500);
  }
  assert.equal((await action('pay')).status, 409);
  assert.equal(await revenue(), 500);

  // Every pre-play paid state can be refunded once; retries cannot double-refund.
  for (const status of ['waiting', 'hold', 'called', 'seated']) {
    const guest = client();
    await guest(api + 'identity', {});
    assert.equal((await guest(api + 'join', { nickname: '返金-' + status, kind: 'beginner' })).status, 201);
    const ticket = async () => (await guest(api + 'me')).data.tickets[0];
    const change = async (action, fields = {}) => {
      const t = await ticket();
      return admin(api + 'action', { scope: 'staff', action, id: t.id, version: t.version, ...fields });
    };
    assert.equal((await change('call')).status, 200);
    assert.equal((await change('pay')).status, 200);
    if (status !== 'called') assert.equal((await change('set-status', { status, ...(status === 'seated' ? { table, seat: 2 } : {}) })).status, 200);
    const t = await ticket();
    assert.equal((await guest(api + 'action', { scope: 'player', action: 'refund', id: t.id, version: t.version, reason: '権限確認' })).status, 403);
    const refund = { op: crypto.randomUUID(), scope: 'staff', action: 'refund', id: t.id, version: t.version, reason: '返金確認' };
    assert.equal((await admin(api + 'action', refund)).status, 200);
    assert.equal((await admin(api + 'action', refund)).status, 200);
    assert.equal((await ticket()).status, 'cancelled');
    assert.equal((await ticket()).paid, 0);
    assert.equal(await revenue(), 500);
    assert.equal((await change('set-status', { status: 'waiting' })).status, 409);
  }
});
