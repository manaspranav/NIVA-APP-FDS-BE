/**
 * Razorpay webhook — SOURCE OF TRUTH for order creation.
 */
const {
  verifyWebhookSignature,
  createOrderFromCapturedPayment,
  getOrderByPaymentId,
} = require('./paymentService');
const {
  isWebhookEventCompleted,
  markWebhookEventCompleted,
  recordPaymentIssue,
} = require('./paymentAudit');
const { notifyOrderPlaced } = require('./orderNotify');

function extractRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (req.body && typeof req.body === 'object') {
    console.warn('[WEBHOOK] Body was pre-parsed — signature may fail. Use express.raw() on this route.');
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return null;
}

async function processPaymentCaptured(pe) {
  const paymentId = pe.id;
  const razorpayOrderId = pe.order_id;
  const paidPaise = pe.amount;

  console.log(
    `[WEBHOOK] payment.captured pay=${paymentId} order=${razorpayOrderId} amount=${paidPaise} paise`
  );

  const result = await createOrderFromCapturedPayment({
    paymentId,
    razorpayOrderId,
    paidPaise,
    source: 'webhook',
  });

  if (result.error === 'no_pending_order') {
    await recordPaymentIssue({
      paymentId,
      razorpayOrderId,
      issueType: 'no_pending_order',
      detail: { paidPaise },
    });
    return { statusCode: 500, body: { status: 'error', detail: 'no_pending_order' }, paymentId };
  }

  if (result.error === 'amount_mismatch') {
    await recordPaymentIssue({
      paymentId,
      razorpayOrderId,
      issueType: 'amount_mismatch',
      detail: { paidPaise },
    });
    return {
      statusCode: 200,
      body: { status: 'error', detail: 'amount_mismatch_manual_review' },
      paymentId,
    };
  }

  if (!result.order) {
    return { statusCode: 500, body: { status: 'error', detail: 'insert_failed' }, paymentId };
  }

  notifyOrderPlaced(result.order, { source: 'webhook', duplicate: result.duplicate }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      status: 'ok',
      order_id: result.order.id,
      duplicate: result.duplicate,
      paymentId,
    },
    paymentId,
  };
}

async function handleOrderPaid(payload, res, razorpay) {
  const orderEntity = payload.order.entity;
  const razorpayOrderId = orderEntity.id;
  console.log(`[WEBHOOK] order.paid: ${razorpayOrderId}`);

  if (!razorpay) {
    return res.status(200).json({ status: 'ok', detail: 'order_paid_no_api_client' });
  }

  try {
    const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
    for (const p of payments.items || []) {
      if (p.status !== 'captured' && p.status !== 'authorized') continue;
      const existing = await getOrderByPaymentId(p.id);
      if (existing) continue;

      const result = await createOrderFromCapturedPayment({
        paymentId: p.id,
        razorpayOrderId,
        paidPaise: p.amount,
        source: 'webhook',
      });

      if (result.order) {
        notifyOrderPlaced(result.order, { source: 'webhook_order_paid' }).catch(() => {});
        return res.status(200).json({ status: 'ok', order_id: result.order.id, via: 'order.paid' });
      }
    }
  } catch (e) {
    console.error('[WEBHOOK] order.paid fetch payments:', e.message);
    return res.status(500).json({ status: 'error', detail: e.message });
  }

  return res.status(200).json({ status: 'ok', detail: 'order_paid_no_action' });
}

async function handleRazorpayWebhook(req, res, options = {}) {
  const { razorpay } = options;
  const ts = new Date().toISOString();
  console.log(`[WEBHOOK] ${ts} POST ${req.originalUrl || '/api/payment/webhook'}`);

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret || webhookSecret.includes('your_')) {
      console.error('[WEBHOOK] FATAL: RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const receivedSignature = req.headers['x-razorpay-signature'];
    if (!receivedSignature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const rawBody = extractRawBody(req);
    if (!rawBody || rawBody.length === 0) {
      return res.status(400).json({ error: 'Empty body' });
    }

    if (!verifyWebhookSignature(rawBody, receivedSignature, webhookSecret)) {
      console.error('[WEBHOOK] Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const body = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : req.body;

    const event = body.event;
    const payload = body.payload;
    const eventId = req.headers['x-razorpay-event-id'] || body.id;

    if (await isWebhookEventCompleted(eventId)) {
      return res.status(200).json({ status: 'ok', detail: 'duplicate_event' });
    }

    console.log('[WEBHOOK] Event:', event, '| id:', eventId);

    let paymentIdForAudit = null;

    switch (event) {
      case 'payment.captured': {
        const out = await processPaymentCaptured(payload.payment.entity);
        paymentIdForAudit = out.paymentId;
        if (out.statusCode === 200 && out.body.order_id) {
          await markWebhookEventCompleted(eventId, event, paymentIdForAudit);
        }
        return res.status(out.statusCode).json(out.body);
      }

      case 'payment.failed': {
        const fp = payload.payment.entity;
        console.log(`[WEBHOOK] payment.failed: ${fp.id}`, fp.error_description || '');
        await markWebhookEventCompleted(eventId, event, fp.id);
        return res.status(200).json({ status: 'ok', detail: 'payment_failed_logged' });
      }

      case 'order.paid': {
        const r = await handleOrderPaid(payload, res, razorpay);
        if (r?.order_id) await markWebhookEventCompleted(eventId, event, null);
        return r;
      }

      default:
        return res.status(200).json({ status: 'ok', detail: 'unhandled_event' });
    }
  } catch (err) {
    console.error('[WEBHOOK] UNHANDLED:', err.message, err.stack);
    return res.status(500).json({ status: 'error', detail: err.message });
  }
}

module.exports = { handleRazorpayWebhook, extractRawBody };
