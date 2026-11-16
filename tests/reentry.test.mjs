import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base=process.env.TEST_URL ?? 'http://127.0.0.1:3000';
let nextClient=240;
function client() {
  const cookies=new Map(), ip=`198.51.100.${nextClient++}`;
  return async (path,body) => {
    const res=await fetch(`${base}/api/${path}`,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:body?JSON.stringify({op:crypto.randomUUID(),...body}):undefined});
    for(const cookie of res.headers.getSetCookie()) {const pair=cookie.split(';')[0],split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1));}
    return {status:res.status,data:await res.json()};
  };
}

test('リエントリーはプレイ中だけ登録でき、料金を売上に、チップを投入量に加え、時間は延長しない',{skip:process.env.TEST_ISOLATED!=='1'},async()=>{
  const admin=client(), key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)[1];
  assert.equal((await admin('login',{key})).status,200);
  const before=(await admin('staff')).data.settings;
  const tables=[];
  const mine=async player=>(await player('me')).data.tickets[0];
  const act=async(player,action,extra={})=>{const t=await mine(player);return admin('action',{scope:'staff',action,id:t.id,version:t.version,...extra});};
  try {
    // Configure the festival terms: expert 300 yen / +200 pt, beginner free / +100 pt.
    assert.equal((await admin('settings',{fee:before.fee,minutes:before.minutes,chips:200,reentry_fee_beginner:0,reentry_fee_expert:300,reentry_chips_beginner:100,reentry_chips_expert:200})).status,200);
    const settings=(await admin('staff')).data.settings;
    assert.equal(settings.reentry_fee_expert,300);assert.equal(settings.reentry_chips_beginner,100);
    for(const kind of ['beginner','expert']) {
      const created=await admin('table-config',{action:'create',name:'リエントリーテスト卓',kind,seat_count:2});
      assert.equal(created.status,201);tables.push(created.data.table);
    }
    const expert=client();
    assert.equal((await expert('identity',{})).status,200);
    assert.equal((await expert('join',{kind:'expert',nickname:'リエントリー確認'})).status,201);

    // Not allowed before play starts.
    assert.equal((await act(expert,'call')).status,200);
    assert.equal((await act(expert,'pay')).status,200);
    assert.equal((await act(expert,'reentry')).status,409);
    assert.equal((await act(expert,'seat',{auto:true})).status,200);
    assert.equal((await act(expert,'reentry')).status,409);
    assert.equal((await act(expert,'start')).status,200);
    const started=await mine(expert);

    // A stale fee shown on the client is rejected instead of charging another amount.
    assert.equal((await act(expert,'reentry',{fee:500})).status,409);

    const revenueBefore=(await admin('staff')).data.revenue;
    const t=await mine(expert);
    const request={op:crypto.randomUUID(),scope:'staff',action:'reentry',id:t.id,version:t.version,fee:300};
    assert.equal((await admin('action',request)).status,200);
    // Re-sending the same operation does not charge twice.
    assert.equal((await admin('action',request)).status,200);
    assert.equal((await act(expert,'reentry',{fee:300})).status,200);
    const after=await mine(expert);
    assert.equal(after.reentry_count,2);
    assert.equal(after.reentry_chips,400);
    assert.equal(after.ends_at,started.ends_at);
    assert.equal(after.initial_chips,200);
    assert.equal((await admin('staff')).data.revenue-revenueBefore,600);

    // Dealers cannot take re-entry payments.
    const invite=(await admin('invite',{role:'dealer',table:tables[1].id}));
    if(invite.status===200) {
      const dealer=client();assert.equal((await dealer('login',{key:invite.data.key})).status,200);
      const current=await mine(expert);
      assert.equal((await dealer('action',{action:'reentry',id:current.id,version:current.version})).status,403);
    }

    assert.equal((await act(expert,'finish',{score:900})).status,200);
    const finished=await mine(expert);
    assert.equal(finished.final_chips,900);assert.equal(finished.reentry_chips,400);
    assert.equal((await act(expert,'reentry')).status,409);

    // Beginner re-entry is free but still recorded.
    const beginner=client();
    assert.equal((await beginner('identity',{})).status,200);
    assert.equal((await beginner('join',{kind:'beginner',nickname:'初心者リエントリー'})).status,201);
    for(const [action,extra] of [['call',{}],['pay',{}],['seat',{auto:true}],['start',{}]]) assert.equal((await act(beginner,action,extra)).status,200);
    const revenueBeginner=(await admin('staff')).data.revenue;
    assert.equal((await act(beginner,'reentry',{fee:0})).status,200);
    const b=await mine(beginner);
    assert.equal(b.reentry_count,1);assert.equal(b.reentry_chips,100);
    assert.equal((await admin('staff')).data.revenue,revenueBeginner);
    assert.equal((await act(beginner,'finish',{score:0})).status,200);
  } finally {
    await admin('settings',{fee:before.fee,minutes:before.minutes,chips:before.chips,reentry_fee_beginner:before.reentry_fee_beginner??0,reentry_fee_expert:before.reentry_fee_expert??300,reentry_chips_beginner:before.reentry_chips_beginner??100,reentry_chips_expert:before.reentry_chips_expert??200});
    for(const table of tables) {const current=(await admin('staff')).data.tables.find(t=>t.id===table.id);if(current)await admin('table-config',{action:'archive',table:table.id,version:current.version});}
  }
});
