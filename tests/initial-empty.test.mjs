import test from 'node:test';
import assert from 'node:assert/strict';
test('新規セットアップは0卓・0席から始まる', {skip:process.env.TEST_FRESH_DB !== '1'},async()=>{
const data=await (await fetch(process.env.TEST_URL+'/api/public')).json();
assert.deepEqual(data.tables,[]);
assert.deepEqual(data.occupancy,{});
assert.deepEqual(data.waitMinutes,{beginner:null,expert:null});
assert.deepEqual(data.tags.map(t=>t.id),['beginner','expert']);
});
