import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

// Pages advanced mode serves the vinext Worker and its relative modules.
await rm('dist/pages', {recursive: true, force: true});
await mkdir('dist/pages', {recursive: true});
await cp('dist/client', 'dist/pages', {recursive: true});
await cp('dist/server', 'dist/pages/_worker.js/app', {recursive: true});
await rm('dist/pages/_worker.js/app/wrangler.json', {force: true});
// Keep the real index.js as an additional module: SSR imports ../index.js.
await writeFile('dist/pages/_worker.js/index.js', "export { default } from './app/index.js';\n");
// Pages requires a standard config filename in its working directory.
const config = JSON.parse(await readFile('wrangler.pages.jsonc', 'utf8'));
config.pages_build_output_dir = '.';
config.d1_databases = config.d1_databases.map(binding => ({
  ...binding, migrations_dir: '../../drizzle',
}));
await writeFile('dist/pages/wrangler.json', JSON.stringify(config, null, 2) + '\n');
await mkdir('dist/pages/.wrangler/deploy', {recursive: true});
await writeFile('dist/pages/.wrangler/deploy/config.json', JSON.stringify({
  configPath: '../../wrangler.json',
}) + '\n');
await writeFile('dist/pages/_routes.json', JSON.stringify({
  version: 1,
  include: ['/*'],
  exclude: ['/assets/*', '/fonts/*', '/og.png', '/utpoker-*.svg'],
}, null, 2) + '\n');
console.log('Pages deployment prepared in dist/pages');
