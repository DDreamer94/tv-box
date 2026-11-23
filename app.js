'use strict';
const el = id => document.getElementById(id);
const media = el('video'), screen = el('player'), dialog = el('settings');
const films = [
  ['Sintel','English','https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv'],
  ['Tears of Steel','English','https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov'],
  ['Big Buck Bunny','No dialogue','https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8']
].map(([name,language,src]) => ({name,language,src,film:true,hls:src.endsWith('.m3u8')}));
let base = localStorage.getItem('catalogue') || '', rows = films, active, hls, timer, locked, opener;
let deferredInstall, gesture, dim = 1, request = 0;
function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
  return url.href.replace(/\/?$/, '/');
}
const validKey = /^[A-Za-z0-9_-]{43}$/;
let catalogueKey = localStorage.getItem('catalogueKey');
function readPersonalLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const initial = params.get('catalogue');
  if (initial) {
    try { base = endpoint(initial); localStorage.setItem('catalogue',base); } catch {}
  }
  const key = params.get('k') || (initial || !catalogueKey ? base : '').match(/\/tvbox-([\w-]{43})\/?$/)?.[1];
  if (validKey.test(key || '') && key !== catalogueKey) {
    catalogueKey = key;
    localStorage.setItem('catalogueKey',key);
    return true;
  }
  return false;
}
readPersonalLink();
window.addEventListener('hashchange', () => {
  if (readPersonalLink()) { setInstallManifest(); loadCatalogue(); }
});
window.addEventListener('storage', event => {
  if (event.key === 'catalogueKey' && validKey.test(event.newValue || '')) {
    catalogueKey = event.newValue;
    loadCatalogue();
  }
});
function notice(text, retry=false) {
  const status=el('notice');
  status.textContent=text;
  if(retry)status.append(' ',action('Retry connection',loadCatalogue));
  status.hidden=!text;
}
function render() {
  const query = el('query').value.trim().toLocaleLowerCase();
  const matches = rows.filter(r => (r.name+' '+r.language+' '+(r.film?'film':'live channel')).toLocaleLowerCase().includes(query));
  const list = el('list'); list.replaceChildren();
  el('count').textContent = matches.length+' '+(matches.length === 1 ? 'title' : 'titles');
  for (const r of matches) {
    const button = document.createElement('button'); button.className='row';
    const name=document.createElement('span'); name.className='name'; name.textContent=r.name;
    if (r.film) { const tag=document.createElement('small'); tag.className='film'; tag.textContent='Film'; name.append(tag); }
    const lang=document.createElement('span'); lang.className='lang'; lang.textContent=r.language;
    button.append(name,lang); button.onclick=()=>openPlayer(r,button); list.append(button);
  }
  if (!matches.length) list.textContent='No matching titles.';
}
async function openPack(token) {
  const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
  const response = await fetch('./catalogue.bin?v=12', {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Catalogue download');
  const pack = new Uint8Array(await response.arrayBuffer());
  const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:pack.slice(0,12)}, key, pack.slice(12));
  const {relay,rows:titles} = JSON.parse(new TextDecoder().decode(clear));
  return titles.map(row => ({...row,src:new URL('stream/'+row.id,relay).href}));
}
function keyFromLink(value) {
  try {
    const url = new URL(value.trim());
    if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./',location.href).pathname)) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const key = params.get('k') || params.get('catalogue')?.match(/\/tvbox-([\w-]{43})\/?$/)?.[1];
    return validKey.test(key || '') ? key : null;
  } catch { return null; }
}

async function connectFromClipboard() {
  // Start the clipboard read inside the user's tap for browsers requiring activation.
  const read = navigator.clipboard?.readText?.();
  const box = settings('Connect this app');
  const label = document.createElement('label');
  label.textContent = 'Paste your personal TV Box link';
  const field = document.createElement('input');
  field.type = 'password';
  field.autocomplete = 'off';
  field.spellcheck = false;
  label.append(field);
  const message = document.createElement('p');
  message.setAttribute('role','status');
  let busy = false;
  async function connect(value) {
    if (busy || !dialog.open || !box.contains(field)) return;
    const key = keyFromLink(value);
    if (!key) {
      message.textContent = 'Copy your personal TV Box link, then paste it here.';
      return;
    }
    busy = true;
    try {
      const entries = await openPack(key);
      if (!dialog.open || !box.contains(field)) return;
      ++request;
      catalogueKey = key;
      localStorage.setItem('catalogueKey',key);
      localStorage.removeItem('lastCatalogue');
      field.value = '';
      rows = entries;
      notice('');
      render();
      setInstallManifest();
      dialog.close();
    } catch { message.textContent = 'Could not open the catalogue with that link. Check your connection and try again.'; }
    finally { busy = false; }
  }
  field.addEventListener('input',()=>{if(keyFromLink(field.value))connect(field.value);});
  box.append(label,action('Connect',()=>connect(field.value)),message);
  try { if (read) await connect(await read); } catch { field.focus(); }
}

function showConnectButton() {
  el('notice').append(' ',action('Connect from copied link',connectFromClipboard));
}
async function loadCatalogue() {
  const turn=++request;
  if (!base && !catalogueKey) { notice('Connect your personal catalogue on this device.'); showConnectButton(); render(); return; }
  notice('Loading your catalogue…');
  try {
    let entries;
    if (catalogueKey) {
      entries=await openPack(catalogueKey);
    } else {
      const response=await fetch(base+'catalog.json',{signal:AbortSignal.timeout(12000),cache:'no-store'});
      if(!response.ok) throw Error();
      const items=await response.json();
      entries=items.map(r=>{
        if (!r.name || !r.language || !/^stream\/[a-f0-9]+$/.test(r.src)) throw Error();
        return {...r,src:new URL(r.src,base).href};
      });
    }
    if(turn!==request)return;
    rows=entries;notice('');
    if (catalogueKey) localStorage.removeItem('lastCatalogue');
  } catch {
    if(turn!==request)return;
    notice('Your catalogue could not be loaded.',true); showConnectButton();
  }
  render();
}
el('query').oninput=render;
function settings(title) {
  el('dialogTitle').textContent=title;el('options').replaceChildren();
  if (!dialog.open) dialog.showModal();
  clearTimeout(timer);
  return el('options');
}
function action(text,fn) {
  const b=document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=fn;return b;
}
el('connect').onclick=()=>{
  const box=settings('Personal catalogue');
  const message=document.createElement('p');
  message.textContent=(base || catalogueKey)?'Refresh the channel list from your personal catalogue.':'Open your personal TV Box link on this device to load your channels.';
  box.append(message);
  if(base || catalogueKey) box.append(action('Refresh catalogue',()=>{dialog.close();loadCatalogue();}));
  box.append(action('Connect from copied link',connectFromClipboard));
};
function reveal() {
  screen.classList.remove('asleep'); clearTimeout(timer);
  if(active && !dialog.open)timer=setTimeout(()=>{screen.classList.add('asleep');el('feedback').hidden=true;},3000);
}
function fail(text) {el('error').querySelector('p').textContent=text; el('error').hidden=false;reveal();}
function openPlayer(row,from) {
  active=row;opener=from;history.pushState({player:true},'',location.pathname+'#watch');
  el('library').hidden=true;screen.hidden=false;locked=false;screen.classList.remove('locked');
  el('lock').textContent='Lock controls';el('lock').setAttribute('aria-pressed','false');el('title').textContent=row.name;
  el('sync').hidden=row.film;el('seek').hidden=!row.film;el('feedback').hidden=true;
  el('back').focus();startStream();reveal();
}
function teardown() {
  if(hls){hls.destroy();hls=null;}
  media.pause();media.removeAttribute('src');media.load();
}
let startTimer, playbackAttempt=0;
function startStream(mode='direct') {
  teardown();el('error').hidden=true;
  const attempt=++playbackAttempt;
  const row=active;
  const source=(mode!=='relay' && row.direct) || row.src;
  const canFallback=source!==row.src;
  const nativeAvailable=row.hls && media.canPlayType('application/vnd.apple.mpegurl') !== '';
  const nativeDirect=canFallback && nativeAvailable && (mode==='native' || !window.Hls?.isSupported());
  const failed=()=>{
    if(attempt!==playbackAttempt || active!==row)return;
    clearTimeout(startTimer);
    if(canFallback)startStream(nativeAvailable && !nativeDirect ? 'native' : 'relay');
    else fail('This stream could not be played over this connection. Try again or choose another title.');
  };
  media.onerror=()=>{if(media.error)failed();};
  clearTimeout(startTimer);
  startTimer=setTimeout(()=>{if(media.readyState<2)failed();},canFallback?9000:25000);
  media.onloadeddata=()=>clearTimeout(startTimer);
  if(row.hls && !nativeDirect)media.crossOrigin='anonymous';else media.removeAttribute('crossorigin');
  const play=()=>media.play().catch(e=>{if(e.name==='NotAllowedError')reveal();});
  if(row.hls && !nativeDirect && window.Hls?.isSupported()) {
    hls=new Hls(); const instance=hls;
    hls.on(Hls.Events.ERROR,(_,e)=>{if(instance===hls && e.fatal)failed();});
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(hls===instance)play();});
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>restoreTracks());
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>restoreTracks());
    hls.loadSource(source);hls.attachMedia(media);
  } else { media.src=source;play(); }
}
el('retry').onclick=()=>startStream();
function closePlayer(){
  clearTimeout(startTimer);playbackAttempt++;active=null;teardown();clearTimeout(timer);gesture=null;screen.hidden=true;screen.classList.remove('locked','asleep');el('library').hidden=false;
  if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  opener?.focus({preventScroll:true});
}
el('back').onclick=()=>history.back();
window.onpopstate=()=>{if(active){if(locked){history.pushState({player:true},'',location.pathname+'#watch');reveal();}else closePlayer();}};
el('lock').onclick=()=>{locked=!locked;screen.classList.toggle('locked',locked);el('lock').textContent=locked?'Unlock':'Lock controls';el('lock').setAttribute('aria-pressed',String(locked));el('feedback').hidden=true;reveal();};
el('play').onclick=()=>{if(media.paused)media.play().catch(()=>fail('Playback could not start.'));else media.pause();reveal();};
function liveTarget() {
  if(Number.isFinite(hls?.liveSyncPosition))return hls.liveSyncPosition;
  return media.seekable.length ? media.seekable.end(media.seekable.length-1) : NaN;
}
el('sync').onclick=()=>{const t=liveTarget();if(Number.isFinite(t))media.currentTime=t;media.play().catch(()=>{});reveal();};
function update() {
  if(!active)return;
  el('play').textContent=media.paused?'Play':'Pause';
  const t=liveTarget(), synced=!media.paused && media.readyState>=3 && Number.isFinite(t) && media.currentTime>=t-1.5;
  el('sync').classList.toggle('current',synced);el('sync').setAttribute('aria-label',synced?'Synced to live':'Sync to live');
  el('seek').disabled=!Number.isFinite(media.duration);if(Number.isFinite(media.duration)){el('seek').max=media.duration;el('seek').value=media.currentTime;}
}
for(const event of ['play','pause','timeupdate','waiting','playing','seeked','durationchange'])media.addEventListener(event,update);
el('seek').oninput=e=>{media.currentTime=Number(e.target.value);reveal();};
el('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(screen.requestFullscreen)await screen.requestFullscreen();else if(media.webkitEnterFullscreen)media.webkitEnterFullscreen();}catch{}reveal();};
function trackSet(text) { return hls ? (text?hls.subtitleTracks:hls.audioTracks) : Array.from((text?media.textTracks:media.audioTracks)||[]); }
function language(t){return t.lang||t.language||'';}
function setTrack(text,index) {
  if(hls){if(text){hls.subtitleDisplay=index>=0;hls.subtitleTrack=index;}else hls.audioTrack=index;}
  else trackSet(text).forEach((t,i)=>{if(text)t.mode=i===index?'showing':'disabled';else t.enabled=i===index;});
}
function restoreTracks() {
  for(const text of [false,true]){
    const pref=localStorage.getItem(text?'subtitle':'audio');if(!pref)continue;
    const index=trackSet(text).findIndex(t=>(language(t)||t.name||t.label)===pref);
    if(text && pref==='off')setTrack(true,-1);else if(index>=0)setTrack(text,index);
  }
}
media.onloadedmetadata=()=>{restoreTracks();update();};
el('tracks').onclick=()=>{
  const box=settings('Audio & subtitles');
  for(const text of [false,true]) {
    const tracks=trackSet(text);const label=document.createElement('label');label.textContent=text?'Subtitles':'Audio';
    const select=document.createElement('select');
    if(text)select.add(new Option('Off','-1'));
    if(!text && !tracks.length)select.add(new Option('Stream default','-1'));
    tracks.forEach((t,i)=>select.add(new Option(t.name||t.label||language(t)||'Track '+(i+1),String(i))));
    const selected=hls?(text?hls.subtitleTrack:hls.audioTrack):tracks.findIndex(t=>text?t.mode==='showing':t.enabled);
    select.value=String(selected<0 && !text && tracks.length?0:selected);select.disabled=!tracks.length;
    select.onchange=()=>{const i=Number(select.value);setTrack(text,i);const t=tracks[i];localStorage.setItem(text?'subtitle':'audio',t?(language(t)||t.name||t.label||''):'off');};
    label.append(select);box.append(label);
  }
};
dialog.addEventListener('close',()=>{if(active)reveal();});
screen.addEventListener('pointerdown',reveal);
screen.addEventListener('focusin',reveal);
const surface=el('surface');
surface.onpointerdown=e=>{surface.setPointerCapture(e.pointerId);gesture={id:e.pointerId,x:e.clientX,y:e.clientY,left:e.clientX<innerWidth/2,dim,volume:media.volume};reveal();};
surface.onpointermove=e=>{
  if(!gesture||gesture.id!==e.pointerId||locked||e.pointerType==='mouse')return;
  const dy=gesture.y-e.clientY;if(Math.abs(dy)<10 || Math.abs(dy)<Math.abs(e.clientX-gesture.x))return;
  const value=Math.min(1,Math.max(0,(gesture.left?gesture.dim:gesture.volume)+dy/(screen.clientHeight*.75)));
  if(gesture.left){dim=Math.max(.05,value);media.style.filter='brightness('+dim+')';}else media.volume=value;
  el('feedback').textContent=(gesture.left?'☀ Brightness ':'♫ Volume ')+Math.round((gesture.left?dim:media.volume)*100)+'%';el('feedback').hidden=false;reveal();
};
surface.onpointerup=surface.onpointercancel=()=>{gesture=null;reveal();};
document.onkeydown=e=>{
  if(dialog.open)return;
  if(active){reveal();if(locked){if(e.key==='Escape'){e.preventDefault();el('lock').focus();}return;}
    if(e.key==='Escape'){e.preventDefault();history.back();}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && document.activeElement!==el('seek')){
      const buttons=[...screen.querySelectorAll('button')].filter(b=>b.offsetParent);
      const dir=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;
      buttons[(buttons.indexOf(document.activeElement)+dir+buttons.length)%buttons.length]?.focus();e.preventDefault();}
  } else if(['ArrowDown','ArrowUp'].includes(e.key)){
    const items=[...el('list').children]; const index=items.indexOf(document.activeElement);
    items[Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();e.preventDefault();}
};
const android = /Android/i.test(navigator.userAgent) || navigator.userAgentData?.platform === 'Android';
const ios = !android && (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function showHomeScreenGuide() {
  const box = settings('Add TV Box to your Home Screen');
  const steps = document.createElement('p');
  steps.textContent = 'In Safari, tap Share, then Add to Home Screen. If you see Open as Web App, turn it on. Tap Add to finish.';
  box.append(steps);
  localStorage.setItem('iosInstallGuideSeen', '1');
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (android || ios || standalone()) return;
  deferredInstall = event;
  el('install').hidden = false;
});
el('install').onclick = async () => {
  if (ios && !standalone()) {
    showHomeScreenGuide();
  } else if (deferredInstall) {
    await deferredInstall.prompt();
    deferredInstall = null;
    el('install').hidden = true;
  }
};
function showCopyLink() {
  const box = settings('Connect your Home Screen app');
  const personal = new URL('./',location.href);
  personal.hash = new URLSearchParams({k:catalogueKey}).toString();
  const message = document.createElement('p');
  message.textContent = 'Copy your link, then open the TV Box icon and tap Connect from copied link.';
  const button = action('Copy personal link',async()=>{
    try {
      await navigator.clipboard.writeText(personal.href);
      button.textContent='Link copied';
      message.textContent='Open your TV Box icon now and tap Connect from copied link.';
    } catch {
      const input=document.createElement('input');
      input.readOnly=true;
      input.value=personal.href;
      input.setAttribute('aria-label','Personal TV Box link');
      box.append(input);
      input.select();
      message.textContent='Choose Copy for the selected link, then return to your TV Box icon.';
      button.hidden=true;
    }
  });
  box.append(message,button);
}
const transferring = new URLSearchParams(location.search).get('connect') === 'home' && catalogueKey;
if (transferring) showCopyLink();
if (ios && !standalone()) {
  el('install').hidden = false;
  if (!transferring && !localStorage.getItem('iosInstallGuideSeen')) showHomeScreenGuide();
}
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  el('install').hidden = true;
});
async function setInstallManifest() {
  const link = el('app-manifest');
  if (!catalogueKey || !navigator.serviceWorker?.controller) {
    link.href = './manifest.webmanifest';
    return;
  }
  try {
    const token = catalogueKey;
    const response = await fetch('./manifest.webmanifest');
    if (!response.ok) throw Error('Manifest unavailable');
    const manifest = await response.json();
    manifest.start_url = './#k=' + token;
    // The private manifest lives only in this browser. Its request URL contains no key.
    const fingerprint = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const address = './manifest.webmanifest?personal=' + Array.from(new Uint8Array(fingerprint).slice(0,12),b=>b.toString(16).padStart(2,'0')).join('');
    const cache = await caches.open('tvbox-install');
    const old = await cache.keys();
    await cache.put(address,new Response(JSON.stringify(manifest),{headers:{'Content-Type':'application/manifest+json'}}));
    if (token !== catalogueKey) return;
    link.href = address;
    for (const entry of old) if (entry.url !== link.href) await cache.delete(entry);
  } catch { link.href = './manifest.webmanifest'; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', setInstallManifest);
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(()=>{});
}
setInstallManifest();
loadCatalogue();
