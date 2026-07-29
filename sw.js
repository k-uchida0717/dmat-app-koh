/* DMAT支援プラットフォーム Service Worker
   オフライン動作のためのキャッシュ制御。
   バージョンを上げると古いキャッシュを破棄して更新します。 */
const CACHE_VERSION = 'dmat-v2';
const CORE_CACHE = CACHE_VERSION + '-core';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// アプリ本体（同一オリジンで必ずキャッシュするもの）
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// CDN等（別オリジン。取れたらキャッシュ、失敗しても続行）
const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(CORE_ASSETS);
    // 外部は個別に（失敗を許容）
    await Promise.allSettled(EXTERNAL_ASSETS.map(u =>
      fetch(u, { mode: 'no-cors' }).then(r => cache.put(u, r)).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地図タイル: キャッシュ優先（オフラインで既訪エリアを再表示）。上限あり。
  if (/tile\.openstreetmap\.org/.test(url.hostname)) {
    event.respondWith(cacheFirstLimited(req, RUNTIME_CACHE, 400));
    return;
  }

  // 同一オリジンのアプリ資産: キャッシュ優先＋裏で更新
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, CORE_CACHE));
    return;
  }

  // 外部（CDN/フォント等）: キャッシュ優先、なければ取得してキャッシュ
  event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fetchPromise;
}

async function cacheFirstLimited(req, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      trimCache(cacheName, maxItems);
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    for (let i = 0; i < keys.length - maxItems; i++) await cache.delete(keys[i]);
  }
}
