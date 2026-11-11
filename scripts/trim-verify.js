const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'index.js');
let s = fs.readFileSync(file, 'utf8');
const marker = 'SECURE PAYMENT VERIFICATION';
const idx = s.indexOf(marker);
if (idx === -1) {
  console.error('marker not found');
  process.exit(1);
}
const start = s.lastIndexOf('/**', idx);
const end = s.indexOf('// Get Razorpay payment details', idx);
if (end === -1) {
  console.error('end not found');
  process.exit(1);
}
const replacement = `/**
 * Payment verify (backup) — webhook is source of truth (lib/paymentVerifyHandler.js)
 */
app.post('/api/payment/verify', (req, res) =>
  handlePaymentVerify(req, res, { razorpay, razorpayKeySecret })
);
app.post('/api/orders/verify-payment', (req, res) =>
  handlePaymentVerify(req, res, { razorpay, razorpayKeySecret })
);

`;
// Remove duplicate routes if already added
s = s.replace(
  /\/\/ Backup verify[\s\S]*?app\.post\('\/api\/orders\/verify-payment'[\s\S]*?\);\s*\n/g,
  ''
);
s = s.slice(0, start) + replacement + s.slice(end);
// Remove legacy comment block if present
s = s.replace(/\/\* LEGACY VERIFY BLOCK[\s\S]*?\}\);\s*\n/g, '');
fs.writeFileSync(file, s);
console.log('trimmed verify block');
