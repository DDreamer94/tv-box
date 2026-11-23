const name='tvbox-shell-v9';
const assets=['./','./index.html','./style.css','./app.js?v=9','./catalogue.bin','./manifest.webmanifest','./icon-192.png','./icon-512.png','./vendor/hls.min.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(name).then(c=>c.addAll(assets.map(url=>new Request(url,{cache:"reload"})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tvbox-shell-')&&k!==name).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.registration.scope))return;
  const url = new URL(event.request.url);
  const home = new URL('./',self.registration.scope);
  if (event.request.mode==='navigate' && (url.pathname===home.pathname || url.pathname===home.pathname+'index.html')) {
    event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{
      if(!response.ok)throw Error('Page unavailable');
      return response;
    }).catch(()=>caches.open(name).then(cache=>cache.match('./index.html'))));
    return;
  }
  event.respondWith(caches.open(name).then(async c=>(await c.match(event.request))||fetch(event.request)));
});
