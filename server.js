/**
 * Minimal Express server — reference for correct Razorpay webhook setup.
 * Production NIVA app uses index.js + Vercel routes; copy middleware order from here.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const webhookRouter = require('./routes/webhook');
const { createOrdersRouter } = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 5000;

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret,
});

app.use(cors());

// CRITICAL: raw body for webhook ONLY — must be before express.json()
app.use(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  webhookRouter
);
app.use(
  '/api/webhook/razorpay',
  express.raw({ type: 'application/json' }),
  webhookRouter
);

app.use((req, res, next) => {
  if (
    req.originalUrl.startsWith('/api/payment/webhook') ||
    req.originalUrl.startsWith('/api/webhook/razorpay')
  ) {
    return next();
  }
  express.json({ limit: '10kb' })(req, res, next);
});

app.use('/api/payment', createOrdersRouter({ razorpay, razorpayKeySecret }));
app.use('/api/orders', createOrdersRouter({ razorpay, razorpayKeySecret }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Payment server listening on ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/api/payment/webhook`);
});

module.exports = app;
