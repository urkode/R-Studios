const cache='r-skisse-v1832';
const assets=['./','./index.html','./css/style.css','./css/fix.css','./css/editor.css','./css/polish.css','./css/finish.css','./css/icons.css','./css/brand.css','./css/sticky.css','./css/home-layout.css','./css/mail-send.css','./assets/brand/rumag-logo-hvit.svg','./assets/brand/rumag-r-hvit.svg','./js/app.js','./js/pdf-export.js','./js/finish.js','./js/editor-flow.js','./js/finish-gallery.js','./js/mail-send.js','./manifest.webmanifest','./assets/icons/app-icon-rskisse.svg','./assets/icons/apple-touch-icon.png','./assets/icons/app-icon-192.png','./assets/icons/app-icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(cache).then(store=>store.addAll(assets)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==cache).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>response).catch(()=>caches.match(event.request)));});

