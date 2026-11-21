import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const policyUrl = 'data:text/javascript;base64,' + Buffer.from(transpile('../lib/manual-status.ts')).toString('base64');
const destination = {id:'destination',kind:'beginner',paused_at:null,archived_at:null,assignment_locked:0,seat_count:3};
let source = transpile('../lib/status-correction.ts')
  .replace(/^import .* from ['"]\.\.\/db['"];$/m, '')
  .replace(/^import .* from ['"]\.\/auth['"];$/m, '')
  .replace(/(['"])\.\/manual-status\1/, JSON.stringify(policyUrl));
source = `class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const table = ${JSON.stringify(destination)};
const database = () => ({prepare(sql){return {bind(){return this;},async first(){if(sql.startsWith('SELECT * FROM game_tables'))return table;if(sql.includes('paused_at IS NULL'))return {id:'source'};return null;}};}});
` + source;
const {statusCorrection} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ticket = {id:1,status:'playing',kind:'beginner',table_id:'source',seat:1,paid:1,started_at:100,ends_at:1800100,paused_ms:0,final_chips:null};

test('受付・運営スタッフはプレイ中の別卓への移動で会計とタイマーを保持する',async()=>{
 for(const role of ['admin','operator','reception']) {
  const {changes,table} = await statusCorrection(ticket,{status:'playing',table:'destination',seat:2},{role},500);
  assert.deepEqual(changes,{table_id:'destination',seat:2});
  assert.equal(table.id,'destination');
  const moved = {...ticket,...changes};
  for(const key of ['status','paid','started_at','ends_at','paused_ms','final_chips'])assert.equal(moved[key],ticket[key]);
 }
});
test('ディーラーと参加者にはステータス修正による別卓移動を許可しない',async()=>{
 for(const role of ['dealer','player'])await assert.rejects(statusCorrection(ticket,{status:'playing',table:'destination',seat:2},{role},500),e=>e.status===409);
});
