const name='tvbox-shell-v1';
const assets=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./vendor/hls.min.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(name).then(c=>c.addAll(assets)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tvbox-shell-')&&k!==name).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.registration.scope))return;
  event.respondWith(caches.open(name).then(async c=>(await c.match(event.request))||fetch(event.request)));
});
