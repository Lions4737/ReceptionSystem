'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { code, type Ticket } from '../lib/types';

type Recovery = {code:string;expiresAt:number};

async function request(path:string,body:Record<string,unknown>) {
  const response=await fetch('/api/'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({op:crypto.randomUUID(),...body}),
  });
  const data=await response.json() as {error?:string;recovery?:Recovery};
  if(!response.ok) throw new Error(data.error??'通信を確認して、もう一度お試しください。');
  return data;
}

export function ReturnToTicket() {
  return <aside className="return-ticket" aria-label="受付済みの方へ">
    <div><strong>すでに受付をお済みですか？</strong><p>番号と待ち状況は、ここから確認できます。</p></div>
    <div className="return-ticket-actions">
      <Link className="button primary" href="/me">自分の受付を開く <span aria-hidden="true">→</span></Link>
      <Link className="text-link" href="/restore">復帰コードで開く</Link>
    </div>
  </aside>;
}

export function RecoveryCard({ticket,forStaff=false}:{ticket:Ticket;forStaff?:boolean}) {
  const [saved,setSaved]=useState<(Recovery & {url:string})|null>(null);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[attempt,setAttempt]=useState(0);
  const linkRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    let current=true;
    void request('recovery',forStaff?{ticketId:ticket.id}:{}).then(data=>{
      if(!data.recovery) throw new Error('保存情報を取得できませんでした。');
      const url=new URL('/restore',window.location.origin);
      // Fragments stay out of HTTP access logs and referrer headers.
      url.hash=new URLSearchParams({code:data.recovery.code}).toString();
      if(current) {setSaved({...data.recovery,url:url.toString()});setError('');}
    }).catch(e=>{if(current)setError(e instanceof Error?e.message:'保存情報を取得できませんでした。');});
    return()=>{current=false;};
  },[ticket.id,forStaff,attempt]);

  const copy=async()=>{
    if(!saved) return;
    try {
      await navigator.clipboard.writeText(saved.url);
      setMessage('リンクをコピーしました。メモなどに貼り付けて保存できます。');
    } catch {
      linkRef.current?.focus();linkRef.current?.select();
      setMessage('下のリンクを長押し、または選択してコピーしてください。');
    }
  };
  const download=()=>{
    if(!saved) return;
    const text=`UTPoker Komaba Festival 受付情報\n\n受付番号: ${code(ticket)}\nお名前: ${ticket.nickname}\n復帰コード: ${saved.code}\n受付を開く: ${saved.url}\n有効期限: ${new Date(saved.expiresAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}\n\nリンクを開くか、ホームの「復帰コードで開く」にコードを入力してください。\nこの情報はご本人用です。\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download=`poker-${code(ticket)}.txt`;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setMessage('受付情報の保存を開きました。保存したファイルから受付を開き直せます。');
  };

  return <section className="recovery-card" id={forStaff?undefined:'save-ticket'} aria-label="受付を開き直すための情報">
    <div className="eyebrow">KEEP YOUR TICKET</div>
    <h2>{forStaff?'受付を開くリンク':'閉じる前に、受付を保存。'}</h2>
    {forStaff&&<p><b>{code(ticket)} / {ticket.nickname}さん</b></p>}
    <p>{forStaff?'受付番号とお名前を確認して、ご本人にお渡しください。':'保存したリンクから、番号と待ち状況を確認できます。別のブラウザでも開けます。'}</p>
    {!saved&&!error&&<p role="status" className="form-help">保存用のリンクを準備しています…</p>}
    {error&&<div className="notice" role="status">{error}<button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>再取得</button></div>}
    {saved&&<>
      <div className="recovery-actions">
        <button type="button" className="button primary" onClick={download}>受付情報を保存 ↓</button>
        <button type="button" className="text-button" onClick={()=>void copy()}>リンクをコピー</button>
      </div>
      <label className="recovery-link-label">受付を開くリンク
        <input ref={linkRef} readOnly value={saved.url} onFocus={e=>e.currentTarget.select()}/>
      </label>
      <div className="recovery-code"><span>復帰コード</span><strong>{saved.code}</strong></div>
      <p className="form-help">このコードのスクリーンショットでも保存できます。<br/>有効期限 {new Date(saved.expiresAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}。リンクとコードはご本人用です。</p>
      {message&&<p role="status" className="recovery-feedback">{message}</p>}
    </>}
  </section>;
}

export function RestoreTicket() {
  const router=useRouter();
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const started=useRef(false),lock=useRef(false);
  const restore=useCallback(async(code:string)=>{
    if(lock.current) return;
    lock.current=true;setBusy(true);setError('');
    try {await request('restore',{code});router.replace('/me');}
    catch(e) {setError(e instanceof Error?e.message:'通信を確認して、もう一度お試しください。');setBusy(false);}
    finally {lock.current=false;}
  },[router]);
  useEffect(()=>{
    if(started.current) return;
    started.current=true;
    const code=new URLSearchParams(window.location.hash.slice(1)).get('code');
    if(code) queueMicrotask(()=>{setValue(code);void restore(code);});
  },[restore]);

  return <main id="main-content" tabIndex={-1} className="mobile-main">
    <Link href="/" className="back-link">← ホームへ</Link>
    <div className="eyebrow">WELCOME BACK</div>
    <h1>受付を開き直す</h1>
    <p className="lead">保存した復帰コードを入力すると、元の受付に戻れます。新しく受付し直す必要はありません。</p>
    <form className="panel restore-form" onSubmit={e=>{e.preventDefault();void restore(value);}}>
      <label>復帰コード
        <input value={value} onChange={e=>setValue(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={64} placeholder="例：A2B3-C4D5-E6F7" required disabled={busy}/>
      </label>
      <p className="form-help">受付番号（B-001など）とは別の、12文字の英数字です。</p>
      {error&&<div className="notice" role="alert">{error}</div>}
      <button className="button primary full large" disabled={busy||!value.trim()}>{busy?'受付を開いています…':'自分の受付を開く →'}</button>
      <p className="form-help center"><Link href="/me">同じブラウザなら、そのまま受付を確認 →</Link></p>
    </form>
    <div className="tip"><div><b>リンクもコードも見つからない場合</b><p>新しく受付せず、スタッフにお声がけください。受付番号やお名前を確認して、開き直すためのリンクをご案内します。</p></div></div>
  </main>;
}
