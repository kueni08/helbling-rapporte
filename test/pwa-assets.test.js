'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Interne App und Kundenportal sind getrennte PWAs mit originalem HE-Icon', async () => {
  const internal = JSON.parse(read('public/manifest.json'));
  const portal = JSON.parse(read('public/kundenportal-manifest.webmanifest'));

  assert.equal(internal.id, '/');
  assert.equal(internal.scope, '/');
  assert.equal(internal.theme_color, '#1C1B78');
  assert.equal(portal.id, '/kundenportal');
  assert.equal(portal.scope, '/kundenportal');
  assert.notEqual(internal.id, portal.id);

  for (const [file, width] of [['he-180.png', 180], ['he-192.png', 192], ['he-512.png', 512], ['he-maskable-512.png', 512]]) {
    const metadata = await sharp(path.join(root, 'public', 'icons', file)).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, width);
  }

  const html = read('public/index.html');
  assert.match(html, /rel="manifest" href="\/manifest\.json"/);
  assert.match(html, /id="pwa-install-btn"/);
  assert.match(html, /\/icons\/he-192\.png/);

  const internalWorker = read('public/sw.js');
  const portalWorker = read('public/kundenportal-sw.js');
  assert.match(internalWorker, /CACHE_PREFIX = 'helbling-rapporte-'/);
  assert.match(portalWorker, /CACHE_PREFIX = 'helbling-kundenportal-'/);
});
