/**
 * Razorpay webhook router — register BEFORE express.json().
 *
 * In server.js / index.js:
 *   const webhookRouter = require('./routes/webhook');
 *   app.use('/api/payment/webhook', express.raw({ type: 'application/json' }), webhookRouter);
 *   app.use('/api/webhook/razorpay', express.raw({ type: 'application/json' }), webhookRouter);
 */
const express = require('express');
const { handleRazorpayWebhook } = require('../lib/paymentWebhookHandler');

const router = express.Router();

router.post('/', handleRazorpayWebhook);
router.post('', handleRazorpayWebhook);

module.exports = router;
