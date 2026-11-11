const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'index.js');
let s = fs.readFileSync(file, 'utf8');
const marker = 'RAZORPAY WEBHOOK HANDLER';
const idx = s.indexOf(marker);
if (idx === -1) {
  console.error('marker not found');
  process.exit(1);
}
const start = s.lastIndexOf('/**', idx);
const end = s.indexOf('// Create Order (backward-compatible', idx);
if (end === -1) {
  console.error('end not found');
  process.exit(1);
}
const replacement = `/**
 * Razorpay webhook — source of truth (lib/paymentWebhookHandler.js)
 * On Vercel, vercel.json routes this path to api/payment/webhook.js instead.
 */
app.post('/api/payment/webhook', (req, res) => handleRazorpayWebhook(req, res));
app.post('/api/webhook/razorpay', (req, res) => handleRazorpayWebhook(req, res));

`;
s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(file, s);
console.log('trimmed webhook block');
