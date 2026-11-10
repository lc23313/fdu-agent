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
const coreFiles = files.filter(
  (file) =>
    !/^assets\/(?:pdf(?:\.worker)?[-.]|jszip\.min-)/.test(file) && !/\.(?:woff2?|ttf)$/.test(file),
);
const digest = createHash('sha256');
for (const file of files) digest.update(file).update(await readFile('apps/pwa/dist/' + file));
const prefix = 'fdu-' + encodeURIComponent(base) + '-';
const cache = prefix + digest.digest('hex').slice(0, 16);
const worker = `
const CACHE=${JSON.stringify(cache)};
const PREFIX=${JSON.stringify(prefix)};
const BASE=${JSON.stringify(base)};
const FILES=${JSON.stringify([base, ...files.map((file) => base + file)])};
const CORE=${JSON.stringify([base, ...coreFiles.map((file) => base + file)])};
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('push',event=>{let data;try{data=event.data.json();}catch{return;}event.waitUntil(self.registration.showNotification(data.title||'FDU Agent',{body:data.body||'有一项任务待处理',tag:data.tag,data:{url:BASE+'?task='+encodeURIComponent(data.task||'')}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=new URL(event.notification.data.url,self.location.origin);if(url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const client=clients.find(c=>c.url.startsWith(self.location.origin+BASE));if(client){await client.navigate(url.href);return client.focus();}return self.clients.openWindow(url.href);}));});
self.addEventListener('message',event=>{if(event.data==='activate')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true}).then(hit=>{
  if(hit)return hit;
  return fetch(event.request).then(response=>{if(response.ok&&FILES.includes(url.pathname))event.waitUntil(cache.put(event.request,response.clone()));return response;}).catch(()=>event.request.mode==='navigate'?cache.match(BASE+'index.html'):Response.error());
 })));
});`;
new Script(worker);
await writeFile('apps/pwa/dist/sw.js', worker);
await writeFile('apps/pwa/dist/.nojekyll', '');
