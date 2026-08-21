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

/* Second target: the same page as a fragment, for hosts that supply their own
 * document skeleton (Claude Artifacts among them). Keeps <title>, drops the
 * doctype/html/head/body wrapper, and uses a plain stylesheet link for the font
 * since inline event handlers may be refused by a host CSP. */
const titleTag = (html.match(/<title>[\s\S]*?<\/title>/) || [])[0];
if (!titleTag) throw new Error('index.html has no <title>');
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();
const fontLink =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">';

/* Embedded viewers never grant download permission, so the fragment ships
 * without the file-saving path at all rather than rendering a button that
 * silently does nothing. Copy-to-clipboard remains the backup route there. */
const DOWNLOAD_SRC = `case 'export-file': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = \`timeblock-backup-\${todayISO()}.json\`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }`;
if (!body.includes(DOWNLOAD_SRC)) throw new Error('download block not found — update DOWNLOAD_SRC in build.js');
const embedBody = body
  .replace(DOWNLOAD_SRC, () => `case 'export-file':
      toast('\u{1F4CB}', 'Use Copy backup', 'This viewer cannot save files directly.');
      break;`)
  .replace('const CAN_DOWNLOAD = (() => { try { return window.self === window.top; } catch (e) { return false; } })();',
           () => 'const CAN_DOWNLOAD = false;   // embedded host: no file saving');

const fragment = `${titleTag}\n${fontLink}\n<style>\n${css}\n</style>\n\n${embedBody}\n`;
if (/URL\.createObjectURL|a\.download/.test(fragment)) throw new Error('fragment still contains a download path');
if (/<!doctype|<\/?(html|body|head)[\s>]/i.test(fragment)) throw new Error('fragment still carries a document wrapper');
if (!fragment.includes('id="view-now"')) throw new Error('fragment lost the app markup');
const fout = path.join(dir, 'dist', 'timeblock.fragment.html');
fs.writeFileSync(fout, fragment);
console.log(`${fout}  (${(Buffer.byteLength(fragment) / 1024).toFixed(1)} KB)`);
