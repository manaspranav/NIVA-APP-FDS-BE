const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'index.js');
let s = fs.readFileSync(file, 'utf8');
const start = s.indexOf('/* LEGACY RECOVER');
if (start === -1) {
  console.log('no legacy recover');
  process.exit(0);
}
const end = s.indexOf("app.post('/api/payment/webhook'", start);
if (end === -1) {
  console.error('end not found');
  process.exit(1);
}
s = s.slice(0, start) + s.slice(end);
fs.writeFileSync(file, s);
console.log('trimmed recover');
