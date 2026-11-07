import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars',`SETUP_KEY="${randomBytes(32).toString('hex')}"\n`,{mode:0o600});
}
mkdirSync('work',{recursive:true});
const key=readFileSync('.dev.vars','utf8').match(/SETUP_KEY="?([a-f0-9]+)"?/)?.[1];
if(key)writeFileSync('work/mvp-access.txt',`ローカルMVP 管理者ログイン\n\nURL: http://localhost:3000/staff/login\n管理者キー: ${key}\n\nこのファイルはGitに含まれません。スタッフの共有パスワードは .dev.vars の STAFF_PASSWORD に設定してください。\n`,{mode:0o600});
console.log('管理者キーを work/mvp-access.txt に保存しました（キーの値は表示していません）。');
