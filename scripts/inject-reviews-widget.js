#!/usr/bin/env node
/**
 * Injects the reviews widget into every doctor profile HTML file
 * under site/doctors/*.html. Idempotent: skips files that already include it.
 *
 * Usage:
 *   node scripts/inject-reviews-widget.js [--dir path]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const DIR = dirIdx >= 0 ? args[dirIdx + 1] : path.join(__dirname, '..', 'doctors');

const WIDGET_SCRIPT = '<script src="/assets/js/reviews-widget.js" defer></script>';
const MARKER = '<!-- reviews-widget:injected -->';

function slugFromFilename(fn) {
  return fn.replace(/\.html$/, '');
}

function injectInto(html, slug) {
  if (html.includes(MARKER)) return null;

  // Try to insert the widget block before the closing </main> or </body>
  const block = `\n${MARKER}\n<section class="reviews-section" style="max-width:960px;margin:40px auto;padding:0 24px">\n  <div id="reviews-widget" data-slug="${slug}"></div>\n</section>\n${WIDGET_SCRIPT}\n`;

  if (html.match(/<\/main>/i)) {
    return html.replace(/<\/main>/i, block + '</main>');
  }
  return html.replace(/<\/body>/i, block + '</body>');
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error('doctors dir not found:', DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));
  let injected = 0, skipped = 0;
  for (const f of files) {
    const full = path.join(DIR, f);
    const html = fs.readFileSync(full, 'utf8');
    const slug = slugFromFilename(f);
    const out = injectInto(html, slug);
    if (out == null) { skipped++; continue; }
    fs.writeFileSync(full, out, 'utf8');
    injected++;
    if (injected % 500 === 0) console.log(`  ...${injected} injected`);
  }
  console.log(`Done. Injected: ${injected}, Skipped (already had widget): ${skipped}, Total: ${files.length}`);
}

main();
