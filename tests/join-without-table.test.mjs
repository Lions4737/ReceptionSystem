import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const {acceptsKind}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('lib/types.ts','utf8'),{module:ts.ModuleKind.ESNext})).toString('base64'));
test('卓の有無にかかわらず種別ごとの受付設定に従う',()=>{
 const data={settings:{beginner_open:1,expert_open:1},tables:[]};
 assert.equal(acceptsKind(data,'expert'),true);
 data.settings.expert_open=0;
 assert.equal(acceptsKind(data,'expert'),false);
 assert.equal(acceptsKind(data,'beginner'),true);
});
test('経験者卓が未作成でも本人・代理受付ができ、受付停止は維持する', {skip:process.env.TEST_ISOLATED!=='1'||!process.env.TEST_URL},async()=>{
 const base=process.env.TEST_URL;
 function client(){const cookies=new Map();return async(path,body,method)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{Origin:base,'Content-Type':'application/json',Cookie:[...cookies.values()].join('; ')},body:body&&JSON.stringify({op:crypto.randomUUID(),...body})});for(const c of r.headers.getSetCookie()){const v=c.split(';')[0];cookies.set(v.split('=')[0],v);}return r;};}
 const admin=client(),p1=client(),p2=client();
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([^"\n]+)"?/)[1];
 assert.equal((await admin('/api/login',{key})).status,200);
 const slug='daily-'+crypto.randomUUID(),api='/event/'+slug+'/api/';
 assert.equal((await admin('/api/events',{slug,name:'日別番号検証'})).status,201);
 assert.equal((await admin('/api/events',{slug,enabled:true},'PATCH')).status,200);
 for(const kind of ['beginner'])assert.equal((await admin(api+'table-config',{action:'create',name:kind,kind,seat_count:3})).status,201);
 for(const [p,kind] of [[p1,'beginner'],[p2,'expert']]){
  await p(api+'identity',{});
  assert.equal((await p(api+'join',{nickname:kind,kind})).status,201);
 }
 const one=(await (await p1(api+'me')).json()).tickets[0];
 const two=(await (await p2(api+'me')).json()).tickets[0];
 assert.equal(one.daily_number,1);assert.equal(two.daily_number,2);
 const staff=await (await admin(api+'staff')).json();
 assert.deepEqual(staff.tickets.map(t=>t.daily_number),[1,2]);
 const proxy=await admin(api+'join',{proxy:true,nickname:'代理経験者',kind:'expert'});
 assert.equal(proxy.status,201);
 const settings=(await (await admin(api+'staff')).json()).settings;
 assert.equal((await admin(api+'settings',{...settings,expert_open:0})).status,200);
 assert.equal((await admin(api+'join',{proxy:true,nickname:'停止確認',kind:'expert'})).status,409);
});
