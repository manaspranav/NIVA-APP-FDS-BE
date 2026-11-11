/**
 * Shared payment logic — used by webhook (source of truth) and verify (backup).
 */
const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const { resolveRestaurantFromItems, resolveOrderStatusAndDeliveryType } = require('./orderRestaurantResolver');

function safeCompareHex(a, b) {
  try {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return a === b;
  }
}

/** Razorpay Checkout success signature: HMAC(order_id|payment_id, key_secret) */
function verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret) {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto.createHmac('sha256', keySecret).update(body).digest('hex');
  return safeCompareHex(expected, razorpaySignature);
}

/** Razorpay webhook signature: HMAC(raw_body, webhook_secret) */
function verifyWebhookSignature(rawBody, receivedSignature, webhookSecret) {
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeCompareHex(receivedSignature, expected);
}

async function getOrderByPaymentId(paymentId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (error) {
    console.error('[PAYMENT] getOrderByPaymentId error:', error.message);
    throw error;
  }
  return data;
}

/** Wait for webhook to finish creating the order (frontend backup path). */
async function waitForOrderByPaymentId(paymentId, { attempts = 3, delayMs = 800 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const order = await getOrderByPaymentId(paymentId);
    if (order) {
      console.log(`[PAYMENT] Order found on poll attempt ${i}: ${order.id}`);
      return order;
    }
    if (i < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function insertOrderWithFallback(supabase, orderRecord) {
  const { data: saved, error: err1 } = await supabase
    .from('orders')
    .insert([orderRecord])
    .select()
    .single();

  if (!err1) return { data: saved, error: null, duplicate: false };

  console.error('[PAYMENT] Full insert failed:', err1.message, '| code:', err1.code);

  if (err1.code === '23505') {
    const { data: existing } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_id', orderRecord.payment_id)
      .maybeSingle();
    if (existing) {
      return { data: existing, error: null, duplicate: true };
    }
  }

  const minimalRecord = {
    customer_id: orderRecord.customer_id,
    customer_name: orderRecord.customer_name || 'Customer',
    customer_email: orderRecord.customer_email || '',
    customer_phone: orderRecord.customer_phone || '',
    customer_college: orderRecord.customer_college || '',
    items: orderRecord.items,
    total_amount: orderRecord.total_amount,
    status: orderRecord.status || 'placed',
    order_date: orderRecord.order_date || new Date().toISOString(),
    placed_at: orderRecord.placed_at || new Date().toISOString(),
    payment_id: orderRecord.payment_id,
    payment_method: 'razorpay',
    razorpay_order_id: orderRecord.razorpay_order_id,
    restaurant_id: orderRecord.restaurant_id || null,
    delivery_type: orderRecord.delivery_type || 'normal',
  };

  const { data: saved2, error: err2 } = await supabase
    .from('orders')
    .insert([minimalRecord])
    .select()
    .single();

  if (!err2) {
    console.warn('[PAYMENT] Minimal insert succeeded — run CRITICAL_MIGRATION.sql for full columns');
    return { data: saved2, error: null, duplicate: false };
  }

  const bareMinimum = {
    items: orderRecord.items,
    total_amount: orderRecord.total_amount,
    status: 'placed',
    payment_id: orderRecord.payment_id,
    payment_method: 'razorpay',
  };

  const { data: saved3, error: err3 } = await supabase
    .from('orders')
    .insert([bareMinimum])
    .select()
    .single();

  return { data: saved3, error: err3, duplicate: false };
}

/**
 * Create order from pending_orders — idempotent by payment_id.
 * Called from webhook (primary) and verify backup (if webhook is slow).
 */
async function createOrderFromCapturedPayment({
  paymentId,
  razorpayOrderId,
  paidPaise,
  source = 'webhook',
}) {
  const supabase = getSupabase();
  const logPrefix = source === 'webhook' ? '[WEBHOOK]' : '[VERIFY]';

  const existing = await getOrderByPaymentId(paymentId);
  if (existing) {
    console.log(`${logPrefix} Order already exists: ${existing.id}`);
    return { order: existing, created: false, duplicate: true };
  }

  const { data: pending, error: pendingErr } = await supabase
    .from('pending_orders')
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (pendingErr) {
    console.error(`${logPrefix} pending_orders query failed:`, pendingErr.message);
    throw pendingErr;
  }

  if (!pending) {
    console.error(`${logPrefix} No pending_order for razorpay_order_id=${razorpayOrderId}`);
    return { order: null, created: false, error: 'no_pending_order' };
  }

  const expectedPaise = Math.round(Number(pending.final_amount) * 100);
  if (paidPaise !== expectedPaise) {
    console.error(`${logPrefix} Amount mismatch: expected ${expectedPaise}, got ${paidPaise}`);
    await supabase
      .from('pending_orders')
      .update({
        status: 'amount_mismatch',
        actual_paid: paidPaise / 100,
        updated_at: new Date().toISOString(),
      })
      .eq('razorpay_order_id', razorpayOrderId);
    return { order: null, created: false, error: 'amount_mismatch' };
  }

  let cust = {
    customer_name: 'Customer',
    customer_email: '',
    customer_phone: '',
    customer_college: '',
  };

  if (pending.customer_id) {
    const { data: c } = await supabase
      .from('customers')
      .select('name, email, phone, college')
      .eq('id', pending.customer_id)
      .maybeSingle();
    if (c) {
      cust = {
        customer_name: c.name || 'Customer',
        customer_email: c.email || '',
        customer_phone: c.phone || '',
        customer_college: c.college || '',
      };
    }
  }

  const items =
    typeof pending.items === 'string' ? pending.items : JSON.stringify(pending.items);

  const coupon = {};
  if (pending.coupon_code) {
    coupon.coupon_code = pending.coupon_code;
    coupon.coupon_discount = pending.discount_amount || 0;
  }

  // Resolve restaurant_id: use value stored in pending_orders (set during create-order),
  // or attempt to resolve from items if not already set
  let restaurantId = pending.restaurant_id || null;
  if (!restaurantId) {
    const parsedItems = typeof pending.items === 'string'
      ? JSON.parse(pending.items)
      : pending.items;
    const { restaurantId: resolved } = await resolveRestaurantFromItems(parsedItems);
    restaurantId = resolved;
  }

  // Determine status and delivery_type for the order
  const { status: orderStatus, deliveryType: orderDeliveryType } =
    resolveOrderStatusAndDeliveryType(pending.delivery_type || 'normal', 'placed');

  const orderRecord = {
    vendor_id: pending.vendor_id || 'niva-fastfoods',
    vendor_name: pending.vendor_name || null,
    customer_id: pending.customer_id || null,
    ...cust,
    items,
    total_amount: pending.final_amount,
    status: orderStatus,
    order_date: new Date().toISOString(),
    placed_at: new Date().toISOString(),
    payment_id: paymentId,
    payment_method: 'razorpay',
    razorpay_order_id: razorpayOrderId,
    delivery_slot: pending.delivery_slot || null,
    delivery_date: pending.delivery_date || null,
    delivery_mode: pending.delivery_mode || null,
    delivery_type: orderDeliveryType,
    hostel_type: pending.hostel_type || null,
    hostel_name: pending.hostel_name || null,
    room_number: pending.room_number || null,
    number_of_packets: pending.number_of_packets || null,
    vendor_platform: pending.vendor_platform || null,
    room_delivery_charge: pending.room_delivery_charge || 0,
    restaurant_id: restaurantId,
    webhook_verified: source === 'webhook',
    ...coupon,
  };

  const { data: raceCheck } = await supabase
    .from('orders')
    .select('id')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (raceCheck) {
    const full = await getOrderByPaymentId(paymentId);
    return { order: full, created: false, duplicate: true };
  }

  const { data: saved, error: insertErr, duplicate } = await insertOrderWithFallback(
    supabase,
    orderRecord
  );

  if (insertErr) {
    console.error(`${logPrefix} ALL INSERT ATTEMPTS FAILED:`, insertErr.message);
    throw insertErr;
  }

  await supabase
    .from('pending_orders')
    .update({
      status: 'paid',
      payment_id: paymentId,
      updated_at: new Date().toISOString(),
    })
    .eq('razorpay_order_id', razorpayOrderId);

  console.log(`${logPrefix} Order ${duplicate ? 'duplicate' : 'created'}: ${saved.id}`);
  return { order: saved, created: !duplicate, duplicate: !!duplicate };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  safeCompareHex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  getOrderByPaymentId,
  waitForOrderByPaymentId,
  createOrderFromCapturedPayment,
  insertOrderWithFallback,
  sleep,
};
