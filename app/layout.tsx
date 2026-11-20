import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { readEventTitle } from '../lib/event-title';
import './fonts.css';
import './globals.css';
export async function generateMetadata():Promise<Metadata> {
  const eventTitle=await readEventTitle();
  const h=await headers(); const host=h.get('x-forwarded-host')??h.get('host')??'localhost:3000';const protocol=host.startsWith('localhost')?'http':'https';
  return {metadataBase:new URL(`${protocol}://${host}`),title:{default:eventTitle,template:'%s | '+eventTitle},description:'一人ひとりに、30分のポーカー体験。受付からテーブルのご案内まで、スマホでスムーズに。',openGraph:{title:eventTitle,description:'戦略・心理・確率。考える楽しさを、テーブルで。',images:[{url:'/og.png',alt:'PLAY. CONNECT. ENJOY.'}],locale:'ja_JP',type:'website'},twitter:{card:'summary_large_image',images:['/og.png']},icons:{icon:'/utpoker-logo.svg'},robots:{index:false,follow:false}};
}
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ja"><body><a className="skip-link" href="#main-content">本文へスキップ</a>{children}</body></html>;}
