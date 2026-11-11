/**
 * Payment recovery — uses shared createOrderFromCapturedPayment (idempotent).
 */
const {
  getOrderByPaymentId,
  waitForOrderByPaymentId,
  createOrderFromCapturedPayment,
} = require('./paymentService');
const { notifyOrderPlaced } = require('./orderNotify');

async function handlePaymentRecover(req, res, { razorpay }) {
  try {
    const { razorpay_order_id, razorpay_payment_id, customer_id } = req.body;

    console.log('[RECOVER] Request', { razorpay_payment_id, razorpay_order_id });

    if (!razorpay_order_id && !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing payment or order ID' });
    }

    if (razorpay_payment_id) {
      const existing = await getOrderByPaymentId(razorpay_payment_id);
      if (existing) {
        return res.json({
          success: true,
          order: existing,
          recovered: false,
          message: 'Order already exists',
        });
      }
    }

    let payment;
    if (razorpay_payment_id) {
      try {
        payment = await razorpay.payments.fetch(razorpay_payment_id);
      } catch (e) {
        return res.status(404).json({ success: false, message: 'Payment not found in Razorpay' });
      }
    } else {
      try {
        const payments = await razorpay.orders.fetchPayments(razorpay_order_id);
        payment = payments.items.find(
          (p) => p.status === 'captured' || p.status === 'authorized'
        );
        if (!payment) {
          return res.json({ success: false, message: 'No successful payment found for this order' });
        }
      } catch (e) {
        return res.status(404).json({ success: false, message: 'Order not found in Razorpay' });
      }
    }

    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return res.json({
        success: false,
        message: `Payment status: ${payment.status}. Not eligible for recovery.`,
      });
    }

    let order = await waitForOrderByPaymentId(payment.id, { attempts: 3, delayMs: 800 });

    if (!order) {
      const result = await createOrderFromCapturedPayment({
        paymentId: payment.id,
        razorpayOrderId: payment.order_id || razorpay_order_id,
        paidPaise: payment.amount,
        source: 'recover',
      });

      if (result.error === 'amount_mismatch') {
        return res.status(400).json({ success: false, message: 'Payment amount mismatch' });
      }
      if (!result.order) {
        return res.status(500).json({
          success: false,
          message: 'Recovery failed. Contact support with payment ID: ' + payment.id,
        });
      }
      order = result.order;
      notifyOrderPlaced(order, { source: 'recover' }).catch(() => {});
      return res.json({
        success: true,
        order,
        recovered: result.created,
        message: 'Order recovered successfully',
      });
    }

    return res.json({
      success: true,
      order,
      recovered: false,
      message: 'Order already exists',
    });
  } catch (error) {
    console.error('[RECOVER] Unhandled:', error.message);
    return res.status(500).json({ success: false, message: 'Recovery failed. Please contact support.' });
  }
}

module.exports = { handlePaymentRecover };
