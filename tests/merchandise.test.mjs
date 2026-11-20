import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_URL;
test('物販の購入・再送・取消とイベント間の分離', {skip: process.env.TEST_ISOLATED!=='1'||!base}, async()=>{
const slug='merch-'+randomUUID(), api='/event/'+slug+'/api';let cookie='';
async function req(path,body,auth=true){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:auth?cookie:''},body:body&&JSON.stringify(body)});if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');return r;}
const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([^"\n]+)"?/)[1];
assert.equal((await req('/api/login',{key,op:randomUUID()})).status,200);
assert.equal((await req('/api/events',{op:randomUUID(),slug,name:'物販検証'})).status,201);
const enable=await fetch(base+'/api/events',{method:'PATCH',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({slug,enabled:true})});
assert.equal(enable.status,200);
const id=randomUUID(),sale=randomUUID();
assert.equal((await fetch(base+api+'/merchandise',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({op:randomUUID(),action:'register',name:'unauthorized',price:300})})).status,401);
assert.equal((await req(api+'/merchandise',{op:id,action:'register',name:'検証用商品',price:300})).status,200);
for(let i=0;i<2;i++)assert.equal((await req(api+'/merchandise',{op:sale,action:'purchase',product_id:id,quantity:3})).status,200);
let snap=await (await req(api+'/staff')).json();let product=snap.merchandise.products.find(p=>p.id===id);assert.equal(product.sold,3);assert.equal(product.revenue,900);
assert.equal((await req(api+'/merchandise',{op:randomUUID(),action:'purchase',product_id:id,quantity:0})).status,400);
const otherSlug='merch-control-'+randomUUID();
assert.equal((await req('/api/events',{op:randomUUID(),slug:otherSlug,name:'物販比較'})).status,201);
assert.equal((await fetch(base+'/api/events',{method:'PATCH',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({slug:otherSlug,enabled:true})})).status,200);
const otherApi='/event/'+otherSlug+'/api';
const other=await(await req(otherApi+'/staff')).json();assert.ok(!other.merchandise?.products.some(p=>p.id===id));
assert.equal((await req(otherApi+'/merchandise',{op:randomUUID(),action:'purchase',product_id:id,quantity:1})).status,404);
assert.equal((await req(api+'/merchandise',{op:randomUUID(),action:'void',sale_id:sale})).status,200);
snap=await(await req(api+'/staff')).json();product=snap.merchandise.products.find(p=>p.id===id);assert.equal(product.sold,0);assert.equal(product.revenue,0);
});
