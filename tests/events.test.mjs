import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const base = process.env.TEST_URL;
const isolated = process.env.TEST_ISOLATED === '1' && Boolean(base);

test('スタッフ専用のイベント作成とイベント間の受付・設定の分離', {skip: !isolated}, async () => {
  function client() {
    const cookies = new Map();
    return async (path, body) => {
      const response = await fetch(base + path, {
        redirect: 'manual',
        method: body ? path === '/api/events' && 'enabled' in body ? 'PATCH' : 'POST' : 'GET',
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          Cookie: [...cookies.values()].join('; '),
        },
        body: body && JSON.stringify({op: randomUUID(), ...body}),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0];
        cookies.set(pair.split('=')[0], pair);
      }
      return response;
    };
  }
  const staff = client();
  const player = client();
  const slug = 'test-' + randomUUID();
  const event = '/event/' + slug;
  const creation = {slug, name: '分離テスト'};
  const key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];

  assert.equal((await player('/event')).status, 307);
  assert.equal((await player('/api/events', creation)).status, 401);
  assert.equal((await staff('/api/login', {key})).status, 200);
  const defaultSettings = (await (await staff('/api/staff')).json()).settings;
  const otherSlug = 'control-' + randomUUID();
  const otherApi = '/event/' + otherSlug + '/api';
  assert.equal((await staff('/api/events', {slug: otherSlug, name: '比較イベント'})).status, 201);
  assert.equal((await staff('/api/events', {slug: otherSlug, enabled: true})).status, 200);
  assert.equal((await staff(otherApi + '/table-config', {
    action: 'create', name: '比較用テスト卓', kind: 'beginner', seat_count: 5,
  })).status, 201);
  assert.equal((await player(otherApi + '/identity', {})).status, 200);
  assert.equal((await player(otherApi + '/join', {nickname: '比較イベントの受付', kind: 'beginner'})).status, 201);
  const original = await (await staff(otherApi + '/staff')).json();
  const originalTicket = (await (await player(otherApi + '/me')).json()).tickets[0];

  assert.equal((await staff('/api/events', creation)).status, 201);
  assert.equal((await staff('/api/events', creation)).status, 409);
  assert.equal((await staff(event + '/api/staff')).status, 403);
  assert.equal((await player(event + '/join')).status, 403);
  assert.equal((await player('/api/events', {slug, enabled: true})).status, 401);
  assert.equal((await staff('/api/events', {slug, enabled: true})).status, 200);
  assert.match(await (await staff('/event')).text(), new RegExp(event + '/staff'));
  assert.match((await staff(event + '/staff')).headers.get('location'), /\/staff\/reception$/);
  assert.equal((await staff(event + '/staff/reception')).status, 200);
  assert.equal((await player(event + '/api/staff')).status, 401);

  const fresh = await (await staff(event + '/api/staff')).json();
  assert.equal(fresh.settings.event_name, creation.name);
  assert.deepEqual(fresh.tickets, []);
  assert.deepEqual(fresh.tables, []);

  assert.equal((await staff(event + '/api/settings', {...fresh.settings, fee: 987})).status, 200);
  assert.equal((await staff(event + '/api/table-config', {
    action: 'create', name: 'テスト卓', kind: 'beginner', seat_count: 5,
  })).status, 201);
  assert.equal((await player(event + '/api/identity', {})).status, 200);
  const nickname = 'イベント分離';
  assert.equal((await player(event + '/api/join', {nickname, kind: 'beginner'})).status, 201);
  const mine = await (await player(event + '/api/me')).json();
  assert.equal(mine.tickets[0].nickname, nickname);
  assert.equal(mine.tickets[0].fee, 987);
  const proxy = {proxy: true, kind: 'beginner'};
  assert.equal((await staff(event + '/api/join', {...proxy, nickname: '  '})).status, 400);
  assert.equal((await staff(event + '/api/join', {...proxy, nickname})).status, 409);
  const ticket = mine.tickets[0];
  assert.equal((await player(event + '/api/action', {
    scope: 'player', action: 'cancel', id: ticket.id, version: ticket.version,
  })).status, 200);
  assert.equal((await staff(event + '/api/join', {...proxy, nickname})).status, 201);
  assert.deepEqual((await (await player(otherApi + '/me')).json()).tickets, [originalTicket]);

  const unchanged = await (await staff(otherApi + '/staff')).json();
  assert.deepEqual((await (await staff('/api/staff')).json()).settings, defaultSettings);
  assert.deepEqual(unchanged.settings, original.settings);
  assert.deepEqual(unchanged.tables, original.tables);
  assert.deepEqual(unchanged.tickets, original.tickets);
  assert.equal((await staff(event + '/api/logout', {})).status, 200);
  assert.equal((await staff('/api/staff')).status, 401);
});
