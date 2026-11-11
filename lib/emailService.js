/**
 * Email Service Module
 *
 * Provides centralized email transporter configuration and email sending functionality.
 * Used by both index.js (for order placed notifications) and restaurantPortal.js (for status updates).
 *
 * Key features:
 * - Single source of truth for nodemailer transporter configuration
 * - Credential validation at startup
 * - Non-blocking email sending (errors logged but don't throw)
 * - Reusable email template for status update emails
 */

const nodemailer = require('nodemailer');

let _transporter = null;

/**
 * Validate that EMAIL_USER and EMAIL_PASS environment variables are configured.
 * Called once at server startup in index.js.
 *
 * @throws {Error} If EMAIL_USER or EMAIL_PASS is missing
 */
function validateEmailCredentials() {
  if (!process.env.EMAIL_USER) {
    throw new Error('Email credential missing: EMAIL_USER not configured. Check .env file.');
  }
  if (!process.env.EMAIL_PASS) {
    throw new Error('Email credential missing: EMAIL_PASS not configured. Check .env file.');
  }
}

/**
 * Get the configured nodemailer transporter instance.
 * Lazy-initializes transporter on first call.
 *
 * @returns {Object} Configured nodemailer transporter
 */
function getTransporter() {
  if (_transporter) return _transporter;

  // Validate credentials before creating transporter
  validateEmailCredentials();

  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  return _transporter;
}

/**
 * Send status update email to customer and admin.
 * Non-blocking: errors are logged but don't throw or block the caller.
 *
 * @param {Object} order - Order object with id, customer_name, customer_email
 * @param {string} targetStatus - Status update: 'taken' | 'out_for_delivery' | 'delivered' | 'cancelled'
 * @returns {Promise<void>} Resolves after email send attempt (or error logged)
 */
async function sendStatusUpdateEmail(order, targetStatus) {
  try {
    if (!order || !order.id) {
      console.error('[EmailService] Invalid order object - missing id');
      return;
    }

    const customerEmail = order.customer_email;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

    // If no valid recipient, skip email sending
    if (!customerEmail && !adminEmail) {
      console.warn('[EmailService] No recipient email found for order:', order.id);
      return;
    }

    console.log('[EmailService] Sending status update email for order:', order.id, 'Status:', targetStatus, 'Customer Email:', customerEmail);

    const transporter = getTransporter();

    // Status label mapping for display in email
    const statusLabels = {
      taken: 'Order Taken — Being Prepared',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled by Restaurant'
    };

    const statusLabel = statusLabels[targetStatus] || targetStatus;
    const subject = `Order Update: ${statusLabel} | NIVA`;
    const html = generateStatusUpdateEmailHTML(order, targetStatus, statusLabel);

    // Send emails in parallel to customer and admin (if both recipients exist)
    const emailPromises = [];

    if (customerEmail) {
      emailPromises.push(
        transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: customerEmail,
          subject,
          html
        }).then(result => {
          console.log('[EmailService] Customer email sent successfully for order', order.id, '- Message ID:', result.messageId);
        }).catch(error => {
          console.error('[EmailService] Customer email failed for order', order.id + ':', error.message);
          // Don't re-throw — email failure should not block order status update
        })
      );
    }

    if (adminEmail) {
      emailPromises.push(
        transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: adminEmail,
          subject: `[Admin] ${subject}`,
          html
        }).then(result => {
          console.log('[EmailService] Admin email sent successfully for order', order.id, '- Message ID:', result.messageId);
        }).catch(error => {
          console.error('[EmailService] Admin email failed for order', order.id + ':', error.message);
          // Don't re-throw — email failure should not block order status update
        })
      );
    }

    // Wait for all email sends (or failures) to complete
    // Using Promise.allSettled ensures all attempts complete regardless of individual failures
    await Promise.allSettled(emailPromises);
    console.log('[EmailService] Email notification process completed for order:', order.id);
  } catch (error) {
    // Log error at service level but don't throw — email failures should not block order operations
    console.error('[EmailService] Error in sendStatusUpdateEmail:', error.message);
  }
}

/**
 * Generate HTML content for order status update email.
 *
 * @param {Object} order - Order object with id, customer_name
 * @param {string} targetStatus - Status key
 * @param {string} statusLabel - Human-readable status label
 * @returns {string} HTML email body
 */
function generateStatusUpdateEmailHTML(order, targetStatus, statusLabel) {
  const orderId = String(order.id).slice(0, 8).toUpperCase();
  const customerName = order.customer_name || 'Customer';
  const timestamp = new Date().toLocaleString('en-IN');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h2 style="margin: 0; font-size: 24px;">NIVA</h2>
          <p style="margin: 4px 0 0; font-size: 14px;">Order Update: ${statusLabel}</p>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>Your order <strong>#${orderId}</strong> status has been updated to <strong>${statusLabel}</strong>.</p>
          
          <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>Order ID:</strong> #${orderId}</p>
            <p style="margin: 0 0 8px 0;"><strong>Status:</strong> ${statusLabel}</p>
            <p style="margin: 0;"><strong>Updated:</strong> ${timestamp}</p>
          </div>
          
          <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">Thank you for ordering with NIVA!</p>
          <p style="color: #6b7280; font-size: 13px; margin: 0;">For assistance, contact us at 9392178949</p>
          <p style="text-align: center; color: #6b7280; margin-top: 15px; font-weight: bold;">Team NIVA</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  validateEmailCredentials,
  getTransporter,
  sendStatusUpdateEmail
};
