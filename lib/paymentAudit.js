/**
 * Payment audit — optional tables (run payment_audit_migration.sql).
 */
const { getSupabase } = require('./supabase');

async function safeInsert(table, row) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from(table).insert([row]);
    if (error && error.code !== '42P01') {
      console.error(`[AUDIT] ${table}:`, error.message);
    }
  } catch (e) {
    console.error(`[AUDIT] ${table}:`, e.message);
  }
}

/** True only if this event was fully processed before (safe for Razorpay retries after 500). */
async function isWebhookEventCompleted(eventId) {
  if (!eventId) return false;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('webhook_events')
      .select('status')
      .eq('id', eventId)
      .maybeSingle();
    return data?.status === 'completed';
  } catch {
    return false;
  }
}

async function markWebhookEventCompleted(eventId, event, paymentId) {
  if (!eventId) return;
  try {
    const supabase = getSupabase();
    await supabase.from('webhook_events').upsert(
      {
        id: eventId,
        event,
        payment_id: paymentId || null,
        status: 'completed',
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  } catch (e) {
    console.error('[AUDIT] markWebhookEventCompleted:', e.message);
  }
}

async function recordPaymentIssue({ paymentId, razorpayOrderId, issueType, detail }) {
  console.error(`[PAYMENT-ISSUE] ${issueType}`, { paymentId, razorpayOrderId, ...detail });
  await safeInsert('payment_issues', {
    payment_id: paymentId,
    razorpay_order_id: razorpayOrderId,
    issue_type: issueType,
    detail: JSON.stringify(detail),
    created_at: new Date().toISOString(),
  });
}

module.exports = {
  isWebhookEventCompleted,
  markWebhookEventCompleted,
  recordPaymentIssue,
};
