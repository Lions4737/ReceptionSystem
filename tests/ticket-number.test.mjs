import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const source=readFileSync('lib/types.ts','utf8');
const {code,dayKey}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
const sql=readFileSync('lib/ticket-number.ts','utf8').match(/dailyNumberSql = '([^']+)'/)[1];
test('日付ごとの受付順：種別共通・取消も採番済み・過去日の番号は固定',()=>{
 const result=JSON.parse(execFileSync('python3',['-c',`
import sqlite3,json,sys
c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE tickets(id INTEGER PRIMARY KEY, day TEXT, kind TEXT, status TEXT)')
c.executemany('INSERT INTO tickets VALUES(?,?,?,?)',[(10,'2026-11-21','beginner','finished'),(12,'2026-11-21','expert','cancelled'),(13,'2026-11-22','expert','waiting'),(15,'2026-11-22','beginner','cancelled'),(16,'2026-11-22','expert','waiting')])
query='SELECT id, '+sys.argv[1]+' AS daily_number FROM tickets ORDER BY id'
assert c.execute(query).fetchall()==[(10,1),(12,2),(13,1),(15,2),(16,3)]
c.execute("INSERT INTO tickets VALUES(17,'2026-11-23','beginner','waiting')")
print(json.dumps(c.execute(query).fetchall()))
`,sql],{encoding:'utf8'}));
 assert.deepEqual(result,[[10,1],[12,2],[13,1],[15,2],[16,3],[17,1]]);
 assert.equal(code({id:13,kind:'expert',daily_number:1}),'E-001');
 assert.equal(code({id:16,kind:'beginner',daily_number:1000}),'B-1000');
});
test('日付の切り替えは日本時間の0時',()=>{
 assert.equal(dayKey(Date.parse('2026-11-22T14:59:59Z')),'2026-11-22');
 assert.equal(dayKey(Date.parse('2026-11-22T15:00:00Z')),'2026-11-23');
});

test('イベント別の本人画面・スタッフ一覧・CSVの番号が一致する', {skip:process.env.TEST_ISOLATED!=='1'||!process.env.TEST_URL},async()=>{
 const base=process.env.TEST_URL;
 function client(){const cookies=new Map();return async(path,body,method)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{Origin:base,'Content-Type':'application/json',Cookie:[...cookies.values()].join('; ')},body:body&&JSON.stringify({op:crypto.randomUUID(),...body})});for(const c of r.headers.getSetCookie()){const v=c.split(';')[0];cookies.set(v.split('=')[0],v);}return r;};}
 const admin=client(),p1=client(),p2=client();
 const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([^"\n]+)"?/)[1];
 assert.equal((await admin('/api/login',{key})).status,200);
 const slug='daily-'+crypto.randomUUID(),api='/event/'+slug+'/api/';
 assert.equal((await admin('/api/events',{slug,name:'日別番号検証'})).status,201);
 assert.equal((await admin('/api/events',{slug,enabled:true},'PATCH')).status,200);
 for(const kind of ['beginner','expert'])assert.equal((await admin(api+'table-config',{action:'create',name:kind,kind,seat_count:3})).status,201);
 for(const [p,kind] of [[p1,'beginner'],[p2,'expert']]){
  await p(api+'identity',{});
  assert.equal((await p(api+'join',{nickname:kind,kind})).status,201);
 }
 const one=(await (await p1(api+'me')).json()).tickets[0];
 const two=(await (await p2(api+'me')).json()).tickets[0];
 assert.equal(one.daily_number,1);assert.equal(two.daily_number,2);
 const staff=await (await admin(api+'staff')).json();
 assert.deepEqual(staff.tickets.map(t=>t.daily_number),[1,2]);
 const csv=await (await admin(api+'export')).text();
 assert.match(csv,/"B-001"/);assert.match(csv,/"E-002"/);
});
