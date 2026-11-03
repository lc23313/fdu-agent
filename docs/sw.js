
const CACHE="fdu-%2Ffdu-agent%2F-4bf3f644e1d9b113";
const PREFIX="fdu-%2Ffdu-agent%2F-";
const BASE="/fdu-agent/";
const FILES=["/fdu-agent/","/fdu-agent/index.html","/fdu-agent/manifest.webmanifest","/fdu-agent/icon-192.png","/fdu-agent/icon-512.png","/fdu-agent/assets/Library-BJKtlxuW.js","/fdu-agent/assets/Library-DhiUHxRI.js","/fdu-agent/assets/drafts-B1gq7WQq.js","/fdu-agent/assets/drafts-DxbTkVHM.js","/fdu-agent/assets/icon-192-DDBZ97AY.png","/fdu-agent/assets/index-BLwalCjk.js","/fdu-agent/assets/index-W6Lhsmhj.css","/fdu-agent/assets/iso-2bwjAcwl.js","/fdu-agent/assets/jszip.min-Du9ITKYx.js","/fdu-agent/assets/pdf-CyczeqB8.js","/fdu-agent/assets/pdf.worker.min-DggqbW7C.js","/fdu-agent/assets/pdf.worker.min-Dswkl-cV.mjs","/fdu-agent/assets/rolldown-runtime-pP25SEvz.js"];
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
});