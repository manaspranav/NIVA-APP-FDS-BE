/**
 * Vercel serverless entry — routes here via vercel.json (NOT index.js webhook).
 * Uses shared handler; raw body from Vercel may need extractRawBody fallback.
 */
const Razorpay = require('razorpay');
const { handleRazorpayWebhook } = require('../../lib/paymentWebhookHandler');

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-razorpay-signature');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return handleRazorpayWebhook(req, res, { razorpay: getRazorpay() });
};
