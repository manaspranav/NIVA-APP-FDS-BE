/**
 * Order-placed notifications — index.js registers sendEmailsToAll here at startup.
 */
let orderPlacedNotifier = null;

function registerOrderPlacedNotifier(fn) {
  orderPlacedNotifier = fn;
}

async function notifyOrderPlaced(order, meta = {}) {
  if (!orderPlacedNotifier || !order) return;
  try {
    await orderPlacedNotifier(order, meta);
  } catch (err) {
    console.error('[NOTIFY] orderPlaced failed (non-fatal):', err.message);
  }
}

module.exports = { registerOrderPlacedNotifier, notifyOrderPlaced };
