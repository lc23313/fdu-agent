import { build, resolveConfig } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
const config = { configFile: 'apps/pwa/vite.config.ts' };
const { base } = await resolveConfig(config, 'build', 'production', 'production');
if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base))
  throw new Error('FDU_PWA_BASE 必须是 / 或 /仓库名/ 形式的站内路径');
await build(config);
const assets = (await readdir('apps/pwa/dist/assets')).sort().map((f) => 'assets/' + f);
const files = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...assets];
const digest = createHash('sha256');
for (const file of files) digest.update(file).update(await readFile('apps/pwa/dist/' + file));
const prefix = 'fdu-' + encodeURIComponent(base) + '-';
const cache = prefix + digest.digest('hex').slice(0, 16);
const worker = `
const CACHE=${JSON.stringify(cache)};
const PREFIX=${JSON.stringify(prefix)};
const BASE=${JSON.stringify(base)};
const FILES=${JSON.stringify([base, ...files.map((file) => base + file)])};
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='activate')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true}).then(hit=>{
  if(hit)return hit;
  return fetch(event.request).catch(()=>event.request.mode==='navigate'?cache.match(BASE+'index.html'):Response.error());
 })));
});`;
new Script(worker);
await writeFile('apps/pwa/dist/sw.js', worker);
await writeFile('apps/pwa/dist/.nojekyll', '');
