import { database, setupKey } from "../db";
import type { Session } from "./types";
export class HttpError extends Error { constructor(public status: number,message: string) { super(message); } }
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
export async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,"0")).join(""); }
type SessionScope = 'player' | 'staff';
const cookieNames: Record<SessionScope, string> = {
  player: 'festival_session',
  staff: 'festival_staff_session',
};
export function cookie(request: Request,token:string,maxAge=86400*7,scope:SessionScope='player') {
  return `${cookieNames[scope]}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==="https:" ? "; Secure" : ""}`;
}
export function sessionToken(request:Request,scope:SessionScope): string|null {
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${cookieNames[scope]}=([a-f0-9]{64})(?:;|$)`))?.[1] ?? null;
}
async function resolveSession(request:Request,scope:SessionScope) {
  // Existing staff sessions used the visitor cookie. Accept them until they
  // expire, and migrate them before creating a visitor session in that browser.
  const sources:SessionScope[]=scope==='staff'&&sessionToken(request,'staff')?['staff']:['player'];
  for(const source of sources) {
    const token=sessionToken(request,source);
    if(!token) continue;
    const value=await database().prepare("SELECT user_id, role, table_id, expires_at FROM sessions WHERE hash=? AND expires_at>?").bind(await hash(token),Date.now()).first<Session>();
    if(value && (scope==='player'?value.role==='player':value.role!=='player')) return {value,token,source};
  }
  return null;
}
export async function session(request:Request,scope:SessionScope): Promise<Session|null> {
  return (await resolveSession(request,scope))?.value ?? null;
}
export async function legacyStaffCookie(request:Request): Promise<string|null> {
  const current=await resolveSession(request,'staff');
  if(!current || current.source!=='player') return null;
  const seconds=Math.max(0,Math.floor((current.value.expires_at-Date.now())/1000));
  return cookie(request,current.token,seconds,'staff');
}
export async function requireStaff(request:Request) {
  const s=await session(request,'staff'); if(!s) throw new HttpError(401,"スタッフとしてログインしてください。"); return s;
}
export function requireRole(s:Session,roles:string[]) { if(!roles.includes(s.role)) throw new HttpError(403,"この操作を行う権限がありません。"); }
export async function payload(request:Request): Promise<Record<string,unknown>> {
  const origin=request.headers.get("origin");
  if(!origin || origin!==new URL(request.url).origin) throw new HttpError(403,"同じサイトの画面から操作してください。");
  if(!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415,"JSON形式で送信してください。");
  const text=await request.text(); if(text.length>16000) throw new HttpError(413,"入力が長すぎます。");
  try { const body=JSON.parse(text); if(!body || typeof body!=="object" || Array.isArray(body)) throw 0; return body; } catch { throw new HttpError(400,"入力を確認してください。"); }
}
export function operationId(body:Record<string,unknown>) { if(typeof body.op!=="string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.op)) throw new HttpError(400,"操作IDが必要です。"); return body.op; }
export function response(value:unknown,status=200,headers:HeadersInit={}) {
  const result=new Headers(headers);
  result.set('Cache-Control','no-store');
  result.set('X-Content-Type-Options','nosniff');
  return Response.json(value,{status,headers:result});
}
export function failure(error:unknown) {
  if(error instanceof HttpError) return response({error:error.message},error.status);
  if(/UNIQUE constraint|constraint failed/.test(String(error))) return response({error:"他の端末で更新されたか、すでに登録されています。最新の状態を確認してください。"},409);
  console.error("request_failed", error instanceof Error ? error.name : "unknown");
  return response({error:"保存を確認できませんでした。状態を更新してから、同じ操作を再試行してください。"},500);
}
export async function throttle(request:Request,purpose='login') {
  const key=await hash(purpose+":"+(request.headers.get("cf-connecting-ip") ?? "local")); const now=Date.now();
  const row=await database().prepare("INSERT INTO attempts(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END,until=CASE WHEN until<? THEN excluded.until ELSE until END RETURNING count").bind(key,now+300000,now,now).first<{count:number}>();
  if((row?.count ?? 99)>15) throw new HttpError(429,"試行回数が多いため、5分後にお試しください。");
}
export async function validSetupKey(key:unknown) {
  const expected=setupKey(); return expected.length>=32 && typeof key==="string" && await hash(key)===await hash(expected);
}
