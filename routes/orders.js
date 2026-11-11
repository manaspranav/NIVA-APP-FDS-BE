/**
 * Payment routes — mount on your Express app.
 *
 *   POST /api/payment/create-order   — (keep in index.js; large cart logic)
 *   POST /api/payment/verify         — backup verify (this file)
 *   POST /api/orders/verify-payment  — alias
 */
const express = require('express');
const { handlePaymentVerify } = require('../lib/paymentVerifyHandler');

function createOrdersRouter({ razorpay, razorpayKeySecret }) {
  const router = express.Router();

  const verifyHandler = (req, res) =>
    handlePaymentVerify(req, res, { razorpay, razorpayKeySecret });

  router.post('/verify-payment', verifyHandler);
  router.post('/verify', verifyHandler);

  return router;
}

module.exports = { createOrdersRouter };
