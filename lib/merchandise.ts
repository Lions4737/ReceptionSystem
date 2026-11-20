import { baseDatabase, currentNamespace } from '../db';
import { HttpError, operationId, requireRole, requireStaff, response } from './auth';

export async function merchandiseSnapshot() {
  const db=baseDatabase(), ns=currentNamespace();
  const [products,sales]=await db.batch([
    db.prepare(`SELECT p.id,p.name,p.price,COALESCE(SUM(CASE WHEN s.voided_at IS NULL THEN s.quantity ELSE 0 END),0) AS sold,COALESCE(SUM(CASE WHEN s.voided_at IS NULL THEN s.quantity*s.unit_price ELSE 0 END),0) AS revenue FROM merchandise_products p LEFT JOIN merchandise_sales s ON s.product_id=p.id AND s.event_namespace=p.event_namespace WHERE p.event_namespace=? GROUP BY p.id ORDER BY p.created_at,p.id`).bind(ns),
    db.prepare(`SELECT s.id,p.name,s.quantity,s.unit_price,s.created_at,s.voided_at FROM merchandise_sales s JOIN merchandise_products p ON p.id=s.product_id WHERE s.event_namespace=? ORDER BY s.created_at DESC,s.id`).bind(ns)
  ]);
  return {products:products.results,sales:sales.results};
}
export async function merchandiseAction(request:Request,b:Record<string,unknown>) {
  const staff=await requireStaff(request); requireRole(staff,['admin','operator']);
  const db=baseDatabase(),ns=currentNamespace(),id=operationId(b),now=Date.now();
  if(b.action==='register') {
    if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>60||typeof b.price!=='number'||!Number.isInteger(b.price)||b.price<0||b.price>1000000) throw new HttpError(400,'商品名と単価を確認してください。');
    await db.prepare('INSERT INTO merchandise_products(id,event_namespace,name,price,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,ns,b.name.trim(),b.price,now).run();
  } else if(b.action==='purchase') {
    if(typeof b.product_id!=='string'||typeof b.quantity!=='number'||!Number.isInteger(b.quantity)||b.quantity<1||b.quantity>1000) throw new HttpError(400,'購入数は1〜1000で入力してください。');
    const result=await db.prepare(`INSERT INTO merchandise_sales(id,event_namespace,product_id,quantity,unit_price,actor,created_at) SELECT ?,event_namespace,id,?,price,?,? FROM merchandise_products WHERE id=? AND event_namespace=? ON CONFLICT(id) DO NOTHING`).bind(id,b.quantity,staff.user_id,now,b.product_id,ns).run();
    if(!result.meta.changes && !await db.prepare('SELECT id FROM merchandise_sales WHERE id=? AND event_namespace=?').bind(id,ns).first()) throw new HttpError(404,'商品が見つかりません。');
  } else if(b.action==='void') {
    if(typeof b.sale_id!=='string') throw new HttpError(400,'購入記録を確認してください。');
    await db.prepare('UPDATE merchandise_sales SET voided_at=? WHERE id=? AND event_namespace=? AND voided_at IS NULL').bind(now,b.sale_id,ns).run();
  } else throw new HttpError(400,'操作を確認してください。');
  return response({ok:true});
}
