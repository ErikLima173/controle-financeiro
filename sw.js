/*
 * sw.js — Deixa o Livro-Caixa abrir sem internet quando instalado como app.
 * Arquivos do próprio site: tenta a internet primeiro (assim as atualizações chegam na hora) e guarda uma
 * cópia; sem internet, usa a cópia. Login e banco (Firebase) não passam por aqui: o Firebase tem a própria
 * cópia dos dados no aparelho.
 */
const CACHE = 'livro-caixa-v1';
const BASE = [
  './', './index.html', './manifest.webmanifest', './css/estilo.css',
  './js/util.js', './js/dados.js', './js/arquivos.js', './js/armazenamento.js', './js/ui.js', './js/config-nuvem.js',
  './js/nuvem.js', './js/graficos.js', './js/planilha.js', './js/mensal.js', './js/app.js',
  './vendor/chart.umd.min.js', './vendor/firebase/firebase-app-compat.js', './vendor/firebase/firebase-auth-compat.js',
  './vendor/firebase/firebase-firestore-compat.js', './icones/icone-192.png', './icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const fontes = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (req.method !== 'GET' || (url.origin !== self.location.origin && !fontes)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await fetch(req);
      if (resp.ok || resp.type === 'opaque') cache.put(req, resp.clone());
      return resp;
    } catch (_) {
      const copia = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (copia) return copia;
      throw _;
    }
  })());
});
