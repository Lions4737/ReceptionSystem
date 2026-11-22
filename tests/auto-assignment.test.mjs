import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Calling assigns real seats. Run only against an explicitly isolated database.
const isolated = process.env.TEST_ISOLATED === '1' && Boolean(process.env.TEST_URL);
const base = process.env.TEST_URL;
let nextClient = 20;
function client() {
  const cookies = new Map(), ip = `192.0.2.${nextClient++}`;
  return async (path, body) => {
    const res = await fetch(`${base}/api/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; ') },
      body: body ? JSON.stringify({ op: crypto.randomUUID(), ...body }) : undefined });
    for (const cookie of res.headers.getSetCookie()) { const [pair] = cookie.split(';'); const split = pair.indexOf('='); cookies.set(pair.slice(0,split),pair.slice(split+1)); }
    return { status: res.status, data: await res.json() };
  };
}
const state = async admin => (await admin('staff')).data;
const mine = async player => (await player('me')).data.tickets[0];
async function configure(admin, id, action, fields = {}) {
  const table = (await state(admin)).tables.find(t=>t.id===id);
  return admin('table-config', { action, table:id, version:table.version, ...fields });
}
async function change(admin, player, action, fields = {}) {
  const ticket = await mine(player);
  return admin('action', { scope:'staff', action, id:ticket.id, version:ticket.version, ...fields });
}
async function fixture() {
  const admin = client();
  const key = readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login',{key})).status,200);
  const original = (await state(admin)).tables;
  for (const table of original) assert.equal((await configure(admin,table.id,'lock',{locked:true})).status,200);
  const players=[], tables=[];
  return {admin, players, tables,
    async table(kind, seats=2) {
      const result=await admin('table-config',{action:'create',name:`自動割り振り ${kind}`,kind,seat_count:seats});
      assert.equal(result.status,201); tables.push(result.data.table); return result.data.table;
    },
    async player(kind='beginner') {
      const player=client(); players.push(player);
      assert.equal((await player('identity',{})).status,200);
      assert.equal((await player('join',{kind,nickname:`自動テスト ${players.length}`})).status,201);
      return player;
    },
    async cleanup() {
      for (const player of players) {
        const ticket=await mine(player);
        if (!ticket) continue;
        if (ticket.status==='playing') await change(admin,player,'finish',{score:0});
        else if (ticket.paid && ['called','seated'].includes(ticket.status)) await change(admin,player,'refund',{reason:'テスト終了'});
        else if (['waiting','called','hold'].includes(ticket.status)) await change(admin,player,'cancel');
      }
      for (const id of tables) await configure(admin,id,'archive');
      for (const table of original) await configure(admin,table.id,'lock',{locked:Boolean(table.assignment_locked)});
      await admin('logout',{});
    }
  };
}

async function paidCall(admin, player) {
  assert.equal((await change(admin,player,'call')).status,200);
  assert.equal((await change(admin,player,'pay')).status,200);
  const ticket=await mine(player);
  assert.equal(ticket.status,'called'); assert.equal(ticket.paid,1);
  assert.equal(ticket.table_id,null); assert.equal(ticket.seat,null);
  return ticket;
}

test('呼び出し・入金では席を確保せず、入金後だけ席を割り振る。二重入金と再抽選を防ぐ', {skip:!isolated}, async()=>{
  const f=await fixture(), {admin}=f;
  try {
    const table=await f.table('beginner',1), p=await f.player();
    assert.equal((await change(admin,p,'seat',{auto:true})).status,409);
    // Old clients may still send a seat with call; it must not reserve it.
    assert.equal((await change(admin,p,'call',{auto:true,table,seat:1})).status,200);
    let ticket=await mine(p);
    assert.equal(ticket.status,'called'); assert.equal(ticket.table_id,null); assert.equal(ticket.seat,null);
    assert.equal((await state(admin)).occupancy[table],0);
    const called=(await admin('display')).data.called.find(t=>t.code.endsWith(String(ticket.daily_number).padStart(3,'0')));
    assert.equal(called.table_id,null); assert.equal(called.seat,null);
    for(const fields of [{auto:true},{table,seat:1}]) assert.equal((await change(admin,p,'seat',fields)).status,409);
    for(const status of ['seated','playing','finished']) assert.equal((await change(admin,p,'set-status',{status,table,seat:1,score:0})).status,409);
    const revenue=(await state(admin)).revenue;
    const pay={scope:'staff',action:'pay',id:ticket.id,version:ticket.version,op:crypto.randomUUID()};
    const results=await Promise.all([admin('action',pay),admin('action',{...pay,op:crypto.randomUUID()})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    ticket=await mine(p);
    assert.equal(ticket.paid,1); assert.equal(ticket.table_id,null); assert.equal(ticket.seat,null);
    assert.equal((await state(admin)).revenue,revenue+ticket.fee);
    assert.equal((await state(admin)).occupancy[table],0);
    assert.equal((await change(admin,p,'pay')).status,409);
    const request={scope:'staff',action:'seat',auto:true,id:ticket.id,version:ticket.version,op:crypto.randomUUID()};
    assert.equal((await admin('action',request)).status,200);
    const reserved=await mine(p);
    assert.equal(reserved.status,'seated'); assert.equal(reserved.table_id,table); assert.equal(reserved.seat,1);
    assert.equal(reserved.started_at,null);
    assert.equal((await admin('action',request)).status,200);
    assert.deepEqual(await mine(p),reserved);
    assert.equal((await state(admin)).revenue,revenue+ticket.fee);
    assert.equal((await admin('audit')).data.operations.filter(o=>o.action==='auto-assign'&&o.ticket_id===ticket.id).length,1);
    // Locking a table after seating does not stop its existing players.
    assert.equal((await configure(admin,table,'lock',{locked:true})).status,200);
    assert.equal((await change(admin,p,'start')).status,200);
    const playing=await mine(p);
    assert.equal(playing.ends_at-playing.started_at,playing.minutes*60000);
  } finally {await f.cleanup();}
});

test('入金済みで空席がなくても記録を保持し、ロック・一時停止・対象タグ・権限を守る', {skip:!isolated}, async()=>{
  const f=await fixture(), {admin}=f;
  try {
    const table=await f.table('beginner',1), expert=await f.table('expert',1);
    assert.equal((await configure(admin,table,'lock',{locked:true})).status,200);
    const p=await f.player(), ticket=await paidCall(admin,p), revenue=(await state(admin)).revenue;
    for(const fields of [{auto:true},{table,seat:1},{table:expert,seat:1}]) assert.equal((await change(admin,p,'seat',fields)).status,409);
    assert.equal((await change(admin,p,'set-status',{status:'seated',table,seat:1})).status,409);
    assert.equal((await change(admin,p,'set-status',{status:'finished',score:0})).status,409);
    assert.deepEqual(await mine(p),ticket);
    assert.equal((await state(admin)).revenue,revenue);
    assert.equal((await configure(admin,table,'lock',{locked:false})).status,200);
    assert.deepEqual(await mine(p),ticket); // No background allocation.
    let current=(await state(admin)).tables.find(t=>t.id===table);
    assert.equal((await admin('table',{table,version:current.version})).status,200);
    assert.equal((await change(admin,p,'seat',{auto:true})).status,409);
    current=(await state(admin)).tables.find(t=>t.id===table);
    assert.equal((await admin('table',{table,version:current.version})).status,200);
    const reception=client(), dealer=client();
    await reception('login',{key:(await admin('invite',{role:'reception'})).data.key});
    await dealer('login',{key:(await admin('invite',{role:'dealer',table})).data.key});
    assert.equal((await change(dealer,p,'seat',{auto:true})).status,403);
    assert.equal((await p('action',{scope:'player',action:'seat',auto:true,id:ticket.id,version:ticket.version})).status,403);
    assert.equal((await change(reception,p,'seat',{table,seat:1})).status,200);
    const other=await f.player(), waiting=await paidCall(admin,other);
    assert.equal((await change(admin,other,'seat',{auto:true})).status,409); // Full; do not undo payment.
    assert.deepEqual(await mine(other),waiting);
    assert.equal((await change(admin,p,'refund',{reason:'席を解放するテスト'})).status,200);
    assert.equal((await mine(other)).status,'called');
    assert.equal((await change(admin,other,'seat',{auto:true})).status,200);
    const e=await f.player('expert'); await paidCall(admin,e);
    assert.equal((await change(admin,e,'seat',{auto:true})).status,200);
    assert.equal((await mine(e)).table_id,expert);
    const refund=await f.player(); await paidCall(admin,refund);
    assert.equal((await change(admin,refund,'refund',{reason:'入金後の未割り振り取消'})).status,200);
    assert.equal((await change(admin,refund,'set-status',{status:'called'})).status,409);
  } finally {await f.cleanup();}
});

test('最後の1席を同時に案内しても重複せず、案内できなかった人の入金を保持する', {skip:!isolated}, async()=>{
  const f=await fixture(), {admin}=f;
  try {
    const table=await f.table('beginner',1), players=[await f.player(),await f.player()];
    for(const p of players) await paidCall(admin,p);
    const revenue=(await state(admin)).revenue;
    const results=await Promise.all(players.map(p=>change(admin,p,'seat',{auto:true})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const tickets=await Promise.all(players.map(mine));
    assert.equal(tickets.filter(t=>t.status==='seated'&&t.table_id===table&&t.seat===1).length,1);
    const pending=tickets.find(t=>t.status==='called');
    assert.equal(pending.paid,1); assert.equal(pending.table_id,null); assert.equal(pending.seat,null);
    assert.equal((await state(admin)).revenue,revenue);
    assert.equal((await state(admin)).occupancy[table],1);
  } finally {await f.cleanup();}
});

test('入金後の案内で人数を均衡させ、未割り振りの呼び出し者と定員差に影響されない', {skip:!isolated}, async()=>{
  const f=await fixture(), {admin}=f;
  try {
    const ids=[await f.table('beginner',7),await f.table('beginner',7),await f.table('beginner',7)];
    const unpaid=await f.player(); assert.equal((await change(admin,unpaid,'call')).status,200);
    const pending=await f.player(); await paidCall(admin,pending);
    const assigned=[];
    for(let i=0;i<12;i++) {
      if(i===9) {
        for(const [index,seats] of [[1,8],[2,9]]) {
          const table=(await state(admin)).tables.find(t=>t.id===ids[index]);
          assert.equal((await configure(admin,table.id,'update',{name:table.name,kind:table.kind,seat_count:seats})).status,200);
        }
      }
      const p=await f.player(); await paidCall(admin,p);
      const before=await state(admin), tables=before.tables.filter(t=>ids.includes(t.id));
      const count=id=>before.tickets.filter(t=>t.table_id===id&&['called','seated','playing'].includes(t.status)).length;
      const minimum=Math.min(...tables.filter(t=>count(t.id)<t.seat_count).map(t=>count(t.id)));
      assert.equal((await change(admin,p,'seat',{auto:true})).status,200);
      const ticket=await mine(p), table=tables.find(t=>t.id===ticket.table_id);
      assert.equal(count(table.id),minimum);
      assert.ok(ticket.seat>=1&&ticket.seat<=table.seat_count);
      assert.equal(before.tickets.some(t=>t.table_id===ticket.table_id&&t.seat===ticket.seat&&['called','seated','playing'].includes(t.status)),false);
      assigned.push(p);
      if(i===0) assert.equal((await change(admin,p,'start')).status,200);
      const after=await state(admin), active=after.tickets.filter(t=>ids.includes(t.table_id)&&['called','seated','playing'].includes(t.status));
      assert.equal(active.length,i+1);
      assert.equal(new Set(active.map(t=>`${t.table_id}:${t.seat}`)).size,active.length);
      for(const previous of before.tickets.filter(t=>ids.includes(t.table_id))) assert.deepEqual(after.tickets.find(t=>t.id===previous.id),previous);
      if(i<9) {
        const counts=ids.map(id=>active.filter(t=>t.table_id===id).length);
        assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
      }
    }
    const final=await Promise.all(assigned.map(mine));
    assert.deepEqual(ids.map(id=>final.filter(t=>t.table_id===id).length),[4,4,4]);
    assert.equal((await mine(unpaid)).table_id,null);
    assert.equal((await mine(pending)).table_id,null);
  } finally {await f.cleanup();}
});

test('9席の自動割り振りでは左右差を2以内に保ち、1番席と9番席を最後に使う', {skip:!isolated}, async()=>{
  const f=await fixture(), {admin}=f;
  try {
    await f.table('beginner',9);
    const seats=[];
    for(let i=0;i<9;i++) {
      const p=await f.player();
      await paidCall(admin,p);
      assert.equal((await change(admin,p,'seat',{auto:true})).status,200);
      const {seat}=await mine(p);
      assert.equal(seat===1||seat===9,i>=7);
      seats.push(seat);
      const left=seats.filter(n=>n<=4).length;
      const right=seats.filter(n=>n>=6).length;
      assert.ok(Math.abs(left-right)<=2);
    }
    assert.equal(new Set(seats).size,9);
  } finally {await f.cleanup();}
});
