'use client';
import { useRef, useState } from 'react';
import type { Snapshot } from '../lib/types';
const yen=(n:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n);
export function Merchandise({data,busy,run}:{data:Snapshot['merchandise'];busy:boolean;run:(body:Record<string,unknown>)=>Promise<boolean>}) {
  const dialog=useRef<HTMLDialogElement>(null), historyDialog=useRef<HTMLDialogElement>(null);
  const [cancelId,setCancelId]=useState<string|null>(null),[historyError,setHistoryError]=useState('');
  const [name,setName]=useState(''),[price,setPrice]=useState(''),[error,setError]=useState(''),[quantities,setQuantities]=useState<Record<string,string>>({});
  const products=data?.products??[];
  return <section className="panel settings-panel merchandise-panel">
    <div className="merchandise-heading"><h2>物品販売</h2><button className="button primary merchandise-add" disabled={busy} onClick={()=>{setError('');dialog.current?.showModal();}}>＋ 商品を登録</button></div><p className="merchandise-help">現金の受け取り後に「購入を記録」を押してください。</p>
    {products.length===0?<p className="merchandise-help">商品を登録すると、購入を記録できます。</p>:<div className="merchandise-products">{products.map(p=>{
      const quantity=Number(quantities[p.id]??'1');
      return <div className="merchandise-product" key={p.id}>
        <strong title={p.name}>{p.name}</strong><span className="merchandise-price">{yen(p.price)}</span>
        <label className="merchandise-quantity"><span>購入数</span><input aria-label={p.name+'の購入数'} type="number" min="1" max="1000" required value={quantities[p.id]??'1'} onChange={e=>setQuantities({...quantities,[p.id]:e.target.value})}/></label>
        <button className="button primary" disabled={busy||!Number.isInteger(quantity)||quantity<1||quantity>1000} onClick={async()=>{if(await run({action:'purchase',product_id:p.id,quantity}))setQuantities(q=>({...q,[p.id]:'1'}));}}>購入を記録</button>
      </div>;
    })}</div>}
    <button className="text-button merchandise-history-open" onClick={()=>{setCancelId(null);setHistoryError('');historyDialog.current?.showModal();}}>購入記録・取り消し</button>
    <dialog ref={historyDialog} className="modal merchandise-history-dialog" aria-labelledby="merchandise-history-title" onCancel={e=>{if(busy)e.preventDefault();}}>
      <div className="section-head"><h2 id="merchandise-history-title">購入記録・取り消し</h2><button type="button" className="icon-button" aria-label="閉じる" disabled={busy} onClick={()=>historyDialog.current?.close()}>×</button></div>
      <p className="merchandise-help">取り消した購入は販売数・売上の集計から除外されます。</p>
      {historyError&&<p className="settings-error" role="alert">{historyError}</p>}
      <div className="merchandise-history-list">{data?.sales.length?data.sales.map(s=><div className="merchandise-history-row" key={s.id}>
        <div><strong>{s.name}</strong><span>{new Date(s.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} · {s.quantity}点 · {yen(s.quantity*s.unit_price)}</span></div>
        {s.voided_at?<span className="merchandise-voided">取消済み</span>:cancelId===s.id?<div className="merchandise-cancel-confirm"><span>この購入を取り消しますか？</span><button className="button" disabled={busy} onClick={()=>setCancelId(null)}>戻る</button><button className="button primary" disabled={busy} onClick={async()=>{setHistoryError('');if(await run({action:'void',sale_id:s.id}))setCancelId(null);else setHistoryError('取り消しできませんでした。接続を確認して再試行してください。');}}>取り消しを確定</button></div>:<button className="text-button" disabled={busy} onClick={()=>setCancelId(s.id)}>購入を取り消す</button>}
      </div>):<p>購入記録はありません。</p>}</div>
    </dialog>
    <dialog ref={dialog} className="modal merchandise-dialog" aria-labelledby="merchandise-register-title" onCancel={e=>{if(busy)e.preventDefault();}}>
      <div className="section-head"><h2 id="merchandise-register-title">商品を登録</h2><button type="button" className="icon-button" aria-label="閉じる" disabled={busy} onClick={()=>dialog.current?.close()}>×</button></div>
      <form onSubmit={async e=>{e.preventDefault();setError('');if(await run({action:'register',name:name.trim(),price:Number(price)})){setName('');setPrice('');dialog.current?.close();}else setError('登録できませんでした。入力内容と接続を確認してください。');}}>
        <label>商品名<input autoFocus required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="例：ステッカー"/></label>
        <label>単価（円）<input required type="number" min="0" max="1000000" value={price} onChange={e=>setPrice(e.target.value)}/></label>
        {error&&<p className="settings-error" role="alert">{error}</p>}
        <div className="merchandise-dialog-actions"><button type="button" className="button" disabled={busy} onClick={()=>dialog.current?.close()}>キャンセル</button><button className="button primary" disabled={busy||!name.trim()||price===''}>登録</button></div>
      </form>
    </dialog>
  </section>;
}

export function MerchandiseStats({data}:{data:Snapshot['merchandise']}) {
  const products=data?.products??[];
  return <section className="panel merchandise-stats">
    <div className="section-head"><h2>物販集計（累計）</h2></div>
    <div className="table-scroll"><table className="queue-table">
      <thead><tr><th scope="col">商品名</th><th scope="col">単価</th><th scope="col">販売数</th><th scope="col">売上</th></tr></thead>
      <tbody>{products.length?products.map(p=><tr key={p.id}><td>{p.name}</td><td>{yen(p.price)}</td><td>{p.sold} 点</td><td>{yen(p.revenue)}</td></tr>):<tr><td colSpan={4}>登録された商品はありません。</td></tr>}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>物販合計</th><td>{products.reduce((n,p)=>n+p.sold,0)} 点</td><td>{yen(products.reduce((n,p)=>n+p.revenue,0))}</td></tr></tfoot>
    </table></div>
  </section>;
}
