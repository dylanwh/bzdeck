/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

// Cache version: this has to be updated whenever a file is modified
const version = '2015-11-22-00-17';

// Files need to be cached
const files = [
  '/app/',
  '/static/images/logo/icon-256-white.png',
  '/static/images/themes/dark/sprite.png',
  '/static/images/themes/light/sprite.png',
  '/static/scripts/combined.js',
  '/static/scripts/workers/readfile.js',
  '/static/scripts/workers/shared.js',
  '/static/styles/combined.css',
  '/static/styles/themes/dark.css',
  '/static/styles/themes/light.css',
  '/vendor/Fira/fonts/FiraMono-Regular.woff2?v=3.206',
  '/vendor/Fira/fonts/FiraSans-LightItalic.woff2?v=4.106',
  '/vendor/Fira/fonts/FiraSans-Medium.woff2?v=4.106',
  '/vendor/Fira/fonts/FiraSans-Regular.woff2?v=4.106',
  '/vendor/Font-Awesome/fonts/fontawesome-webfont.woff2?v=4.4.0',
];

// Virtual URLs to be resolved to the app's static base URL. This list should be synced with .htaccess
const pattern = /^\/((attachment|bug|home|profile|search|settings).*)?$/;

self.addEventListener('install', event => {
  event.waitUntil(
    // Cache the files
    caches.open(version).then(cache => cache.addAll(files))
  );
});

self.addEventListener('fetch', event => {
  let request = event.request;

  // Rewrite in-app requests as .htaccess does
  if (pattern.test((new URL(event.request.url)).pathname)) {
    request = new Request('/app/');
  }

  event.respondWith(
    // Proxy requests and cache files when needed
    // TODO: Provide custom 404 page
    caches.match(request).then(response => {
      // Return cache if found
      if (response) {
        return response;
      }

      // Request remote resource
      return fetch(request).then(response => {
        caches.open(version).then(cache => cache.put(request, response));

        return response.clone();
      });
    })
    .catch(error => new Response('404 Not Found', { status: 404 }))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    // Delete old caches
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== version).map(key => caches.delete(key))))
  );
});
