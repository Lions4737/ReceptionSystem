import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.TEST_URL ?? 'http://127.0.0.1:3000';

test('イベント名の保存・入力検証・再読込時の表示ができ、他の設定が保たれる', async () => {
  let cookie = '';
  const call = async (path, body) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.248', Cookie: cookie },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined,
    });
    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
  const original = (await call('public')).data.settings;
  const key = readFileSync('.dev.vars', 'utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await call('login', { key })).status, 200);

  try {
    const title = 'UTPoker Komaba Festival · 運営名テスト';
    assert.equal((await call('settings', { ...original, event_name: `  ${title}  ` })).status, 200);
    assert.deepEqual((await call('public')).data.settings, { ...original, event_name: title });

    // A fresh request must use the saved title before any client-side polling.
    const html = await (await fetch(`${base}/me`)).text();
    assert.ok(html.includes(`<title>${title}</title>`));
    assert.ok(html.includes(`aria-label="${title} ホーム"`));

    for (const invalid of ['', '   ', '祭'.repeat(81), null, 12]) {
      assert.equal((await call('settings', { ...original, event_name: invalid })).status, 400);
      assert.equal((await call('public')).data.settings.event_name, title);
    }

    // Older clients that omit event_name must not reset the current title.
    const { event_name: _oldTitle, ...legacy } = original;
    assert.equal((await call('settings', legacy)).status, 200);
    assert.deepEqual((await call('public')).data.settings, { ...original, event_name: title });
  } finally {
    assert.equal((await call('settings', original)).status, 200);
    await call('logout', { scope: 'staff' });
  }
});
