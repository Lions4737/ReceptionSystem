import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base=process.env.TEST_URL ?? 'http://127.0.0.1:3000';
let nextClient=200;
function client() {
  const cookies=new Map(), ip=`198.51.100.${nextClient++}`;
  return async (path,body) => {
    const res=await fetch(`${base}/api/${path}`,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:body?JSON.stringify({op:crypto.randomUUID(),...body}):undefined});
    for(const cookie of res.headers.getSetCookie()) {const pair=cookie.split(';')[0],split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1));}
    return {status:res.status,data:await res.json()};
  };
}

test('不在復帰は対象別の待機列の先頭へ戻り、手動変更・同時復帰・再送でも順序を保持する',{skip:process.env.TEST_ISOLATED!=='1'},async()=>{
  const admin=client(), key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login',{key})).status,200);
  const tables=[],players=[];
  const mine=async player=>(await player('me')).data.tickets[0];
  const act=async(player,action,extra={})=>{const t=await mine(player);return admin('action',{scope:'staff',action,id:t.id,version:t.version,...extra});};
  const waiting=async kind=>(await admin('staff')).data.tickets.filter(t=>t.kind===kind&&t.status==='waiting');
  const join=async kind=>{const p=client();players.push(p);assert.equal((await p('identity',{})).status,200);assert.equal((await p('join',{kind,nickname:'先頭復帰テスト'})).status,201);return p;};
  const hold=async p=>assert.equal((await act(p,'set-status',{status:'hold'})).status,200);
  try {
    for(const kind of ['beginner','expert']) {
      const created=await admin('table-config',{action:'create',name:'復帰テスト卓',kind,seat_count:2});
      assert.equal(created.status,201);tables.push(created.data.table);
    }
    const returning=await join('beginner');await hold(returning);
    const first=await join('beginner'), second=await join('beginner'), expert=await join('expert');
    const original=(await waiting('beginner')).map(t=>t.id), expertBefore=await mine(expert), held=await mine(returning);
    const request={op:crypto.randomUUID(),scope:'staff',action:'requeue',id:held.id,version:held.version};
    assert.equal((await admin('action',request)).status,200);
    const restored=await mine(returning), queue=await waiting('beginner');
    assert.deepEqual(queue.map(t=>t.id),[restored.id,...original]);
    assert.ok(restored.queued_at<queue[1].queued_at);
    assert.equal(restored.created_at,held.created_at);
    assert.equal(restored.table_id,null);assert.equal(restored.seat,null);assert.equal(restored.called_at,null);
    assert.equal((await returning('me')).data.position,1);
    assert.deepEqual(await mine(expert),expertBefore);
    assert.equal((await admin('action',request)).status,200);
    assert.deepEqual(await mine(returning),restored);
    assert.equal((await admin('action',{...request,op:crypto.randomUUID()})).status,409);

    // The status editor applies the same policy as the dedicated return button.
    await hold(returning);
    assert.equal((await act(returning,'set-status',{status:'waiting'})).status,200);
    assert.equal((await waiting('beginner'))[0].id,restored.id);

    // Two simultaneous returns are assigned distinct positions ahead of everyone waiting.
    const a=await join('beginner'), b=await join('beginner');await hold(a);await hold(b);
    const previous=(await waiting('beginner')).map(t=>t.id);
    const results=await Promise.all([act(a,'requeue'),act(b,'requeue')]);
    assert.ok(results.every(r=>r.status===200));
    const concurrent=await waiting('beginner'), ids=[(await mine(a)).id,(await mine(b)).id];
    assert.deepEqual(concurrent.slice(0,2).map(t=>t.id).sort(),ids.sort());
    assert.notEqual(concurrent[0].queued_at,concurrent[1].queued_at);
    assert.deepEqual(concurrent.slice(2).map(t=>t.id),previous);

    // An empty queue remains usable, and new arrivals line up behind the returned guest.
    await hold(expert);
    const started=Date.now();
    assert.equal((await act(expert,'requeue')).status,200);
    assert.ok((await mine(expert)).queued_at>=started);
    assert.equal((await expert('me')).data.position,1);
    const nextExpert=await join('expert');
    assert.equal((await nextExpert('me')).data.position,2);

    // Other manual changes to waiting still go to the back.
    assert.equal((await act(first,'call')).status,200);
    assert.equal((await act(first,'set-status',{status:'waiting'})).status,200);
    assert.equal((await waiting('beginner')).at(-1).id,(await mine(first)).id);
    assert.equal((await second('me')).data.tickets.length,1);
  } finally {
    for(const player of players) {const t=await mine(player);if(t&&['waiting','called','hold'].includes(t.status))await act(player,'cancel');}
    for(const id of tables) {const table=(await admin('staff')).data.tables.find(t=>t.id===id);if(table)await admin('table-config',{action:'archive',table:id,version:table.version});}
    await admin('logout',{});
  }
});
