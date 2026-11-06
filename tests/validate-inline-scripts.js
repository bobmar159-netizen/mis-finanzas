const fs = require('node:fs');
const vm = require('node:vm');

const target = process.argv[2];
if (!target) throw new Error('Uso: node tests/validate-inline-scripts.js <index.html>');
const html = fs.readFileSync(target, 'utf8');
const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = pattern.exec(html))) {
  if (/\bsrc=|application\/(?:json|ld\+json)/i.test(match[1])) continue;
  count += 1;
  new vm.Script(match[2], { filename: `inline-${count}.js` });
}
console.log(`Inline scripts OK: ${count}`);
