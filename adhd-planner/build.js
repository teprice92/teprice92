#!/usr/bin/env node
/* Inlines styles.css and app.js into a single portable HTML file.
 * Usage: node build.js  ->  dist/timeblock.html
 * No dependencies; the output opens from a USB stick or any static host. */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const css = read('styles.css');
const js = read('app.js');
let html = read('index.html');

/* The replacements MUST go through a function. A plain string replacement makes
 * String.replace interpret $$, $&, $` and $' inside the payload — and app.js uses
 * $$() as its query-all helper, every instance of which would silently become $(). */
html = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${js}\n</script>`);

if (html.includes('styles.css') && !html.includes('<style>')) throw new Error('CSS was not inlined');
if (html.includes('src="app.js"')) throw new Error('JS was not inlined');
if (html.includes('</script>', html.indexOf('<script>') + 8) === false) throw new Error('script block malformed');

const countJs = (h, needle) => h.split(needle).length - 1;
for (const needle of ['$$(', '${']) {
  if (countJs(html, needle) < countJs(js, needle)) {
    throw new Error(`inlining mangled "${needle}" — check the replacement is a function, not a string`);
  }
}

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist', 'timeblock.html');
fs.writeFileSync(out, html);
console.log(`${out}  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
