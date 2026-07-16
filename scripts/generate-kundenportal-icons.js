'use strict';

const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..', 'public', 'icons');
const regular = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="88" fill="#1C1B78"/><text x="256" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="220" font-weight="700" fill="white">HR</text></svg>`);
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1C1B78"/><text x="256" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="190" font-weight="700" fill="white">HR</text></svg>`);

Promise.all([
  sharp(regular).resize(192, 192).png().toFile(path.join(root, 'kundenportal-192.png')),
  sharp(regular).resize(512, 512).png().toFile(path.join(root, 'kundenportal-512.png')),
  sharp(maskable).resize(512, 512).png().toFile(path.join(root, 'kundenportal-maskable-512.png')),
]).catch(error => { console.error(error); process.exitCode = 1; });
