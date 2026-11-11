/**
 * Payment verify — BACKUP to webhook.
 * Does NOT rely on the browser alone; polls for webhook-created order, then idempotent create if needed.
 */
const {
  verifyCheckoutSignature,
  getOrderByPaymentId,
  waitForOrderByPaymentId,
  createOrderFromCapturedPayment,
} = require('./paymentService');
const { notifyOrderPlaced } = require('./orderNotify');

async function handlePaymentVerify(req, res, { razorpay, razorpayKeySecret }) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      customer_id,
      customer_name,
      customer_email,
      customer_phone,
      customer_college,
    } = req.body;

    console.log('[VERIFY] Request', {
      razorpay_order_id,
      razorpay_payment_id,
      signature: razorpay_signature ? 'present' : 'MISSING',
    });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment details.',
      });
    }

    if (!razorpayKeySecret) {
      return res.status(500).json({ success: false, message: 'Payment verification not configured' });
    }

    if (
      !verifyCheckoutSignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        razorpayKeySecret
      )
    ) {
      console.error('[VERIFY] Invalid signature');
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
    }

    console.log('[VERIFY] Signature OK');

    let payment;
    try {
      payment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (e) {
      console.error('[VERIFY] Razorpay fetch failed:', e.message);
      return res.status(500).json({
        success: false,
        message: 'Could not verify payment with Razorpay.',
        payment_id: razorpay_payment_id,
      });
    }

    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return res.status(400).json({
        success: false,
        message: `Payment status: ${payment.status}`,
        status: payment.status,
      });
    }

    let order = await getOrderByPaymentId(razorpay_payment_id);
    if (order) {
      console.log('[VERIFY] Order already exists (webhook or prior verify):', order.id);
      return res.json({
        success: true,
        message: 'Payment verified',
        duplicate: true,
        order,
        payment: {
          id: razorpay_payment_id,
          order_id: razorpay_order_id,
          amount: payment.amount / 100,
          status: payment.status,
        },
      });
    }

    console.log('[VERIFY] Waiting for webhook to create order...');
    order = await waitForOrderByPaymentId(razorpay_payment_id, {
      attempts: 8,
      delayMs: 1000,
    });

    if (!order) {
      console.warn('[VERIFY] Webhook slow/missed — backup create from pending_orders');
      const result = await createOrderFromCapturedPayment({
        paymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        paidPaise: payment.amount,
        source: 'verify',
      });

      if (result.error === 'amount_mismatch') {
        return res.status(400).json({
          success: false,
          message: 'Payment amount mismatch.',
          error_code: 'AMOUNT_MISMATCH',
        });
      }

      if (!result.order) {
        return res.status(500).json({
          success: false,
          message:
            'Payment captured but order could not be saved. Webhook will retry — check Orders in a few minutes or contact support.',
          payment_id: razorpay_payment_id,
        });
      }

      order = result.order;
    }

    notifyOrderPlaced(order, { source: 'verify' }).catch(() => {});

    if (customer_id && order.customer_id !== customer_id) {
      console.warn('[VERIFY] customer_id mismatch — order still returned');
    }

    return res.json({
      success: true,
      message: 'Payment verified',
      order,
      payment: {
        id: razorpay_payment_id,
        order_id: razorpay_order_id,
        amount: payment.amount / 100,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
      },
      customer: {
        customer_id,
        customer_name,
        customer_email,
        customer_phone,
        customer_college,
      },
    });
  } catch (error) {
    console.error('[VERIFY] Unhandled:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment.',
      error: error.message,
    });
  }
}

module.exports = { handlePaymentVerify };
