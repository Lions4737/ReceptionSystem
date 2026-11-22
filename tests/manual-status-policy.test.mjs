import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../lib/manual-status.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {manualStatusIssue,manualStatusWarning,manualStatusPaid}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ticket={status:'playing',paid:1,table_id:'A',seat:1,minutes:30};
test('受付・運営スタッフもプレイ中と終了をまたいで修正でき、影響を警告する',()=>{
 for(const role of ['admin','operator','reception'])for(const target of ['waiting','hold','seated','finished']){
  assert.equal(manualStatusIssue(ticket,target,role),null);
  assert.ok(manualStatusWarning(ticket,target));
 }
 assert.doesNotMatch(manualStatusWarning(ticket,'waiting'),/未入金|差し引き/);
 assert.match(manualStatusWarning({...ticket,status:'finished'},'playing'),/最終チップ数.*消去.*30分/);
 assert.ok(manualStatusWarning(ticket,'playing'));
});
test('入金をまたぐ変更に入金状態と警告が連動する',()=>{
 assert.equal(manualStatusIssue({...ticket,paid:0,status:'waiting'},'playing','operator'),null);
 assert.equal(manualStatusIssue(ticket,'cancelled','admin'),null);
 for(const target of ['waiting','called','hold']) {
  assert.equal(manualStatusPaid(ticket,target),1);
  assert.equal(manualStatusPaid({...ticket,paid:0},target),0);
  assert.doesNotMatch(manualStatusWarning(ticket,target),/加算|差し引き/);
 }
 assert.equal(manualStatusPaid(ticket,'cancelled'),0);
 assert.match(manualStatusWarning({...ticket,fee:500},'cancelled'),/500円.*差し引き/);
 for(const target of ['seated','playing','finished']) assert.equal(manualStatusPaid({...ticket,status:'waiting',paid:0},target),1);
 assert.equal(manualStatusPaid({...ticket,status:'called'},'called'),1);
 assert.match(manualStatusWarning({...ticket,status:'waiting',paid:0,fee:500},'playing'),/500円.*加算/);
 assert.ok(manualStatusIssue(ticket,'seated','dealer'));
});
