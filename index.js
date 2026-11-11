const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const { handleRazorpayWebhook } = require('./lib/paymentWebhookHandler');
const { handlePaymentVerify } = require('./lib/paymentVerifyHandler');
const { handlePaymentRecover } = require('./lib/paymentRecoverHandler');
const { registerOrderPlacedNotifier } = require('./lib/orderNotify');
const { resolveRestaurantFromItems, resolveOrderStatusAndDeliveryType } = require('./lib/orderRestaurantResolver');
const { validateEmailCredentials, getTransporter } = require('./lib/emailService');
const vendorCatalog = require('./lib/vendorCatalog');
const { createVendorRouter } = require('./routes/vendorRoutes');
const partnerOrdersRouter = require('./routes/partnerOrders');
const restaurantPortalRouter = require('./routes/restaurantPortal');
const adminRestaurantsRouter = require('./routes/adminRestaurants');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

dotenv.config();
// Local dev: .env.local overrides .env (use test keys without changing production values)
if (!process.env.VERCEL) {
  dotenv.config({ path: '.env.local', override: true });
}

const app = express();
const PORT = process.env.PORT || 5000;

// Security: Rate limiting for API protection
const rateLimit = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 300; // Max requests per minute per IP (increased for development with multiple concurrent components)

const rateLimitMiddleware = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimit[ip]) {
    rateLimit[ip] = { count: 1, startTime: now };
  } else {
    if (now - rateLimit[ip].startTime > RATE_LIMIT_WINDOW) {
      rateLimit[ip] = { count: 1, startTime: now };
    } else {
      rateLimit[ip].count++;
      if (rateLimit[ip].count > MAX_REQUESTS) {
        return res.status(429).json({ 
          success: false, 
          error: 'Too many requests. Please try again later.' 
        });
      }
    }
  }
  next();
};

// CORS Configuration for Production - Updated to support multiple ports
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://niva-frontend.vercel.app',
  'https://niva2026.in',
  'https://www.niva2026.in'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list or is a Vercel preview deployment
    if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Security Headers Middleware
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com;");
  next();
};

// Middleware
app.use(cors(corsOptions));
app.use(compression()); // Gzip compression - reduces response size by 60-80%
app.use(securityHeaders);
app.use(rateLimitMiddleware);

// RAW BODY for Razorpay webhooks — MUST be before express.json()
const WEBHOOK_PATHS = ['/api/payment/webhook', '/api/webhook/razorpay'];
function isWebhookPath(url = '') {
  const path = url.split('?')[0];
  return WEBHOOK_PATHS.includes(path);
}
WEBHOOK_PATHS.forEach((p) => {
  app.use(p, express.raw({ type: 'application/json' }));
});

app.use((req, res, next) => {
  if (isWebhookPath(req.originalUrl)) return next();
  bodyParser.json({ limit: '10kb' })(req, res, next);
});
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));

// Static asset caching - serve with 30-day browser cache
app.use(express.static('public', {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  immutable: true
}));

// API response caching headers for GET product endpoints
app.use('/api/products', (req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=300');
  }
  next();
});

// Input Validation & Sanitization Helpers
const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/<[^>]*>/g, '').substring(0, 500);
};

const validatePhone = (phone) => {
  if (!phone) return false;
  const cleanPhone = phone.replace(/\D/g, '');
  return cleanPhone.length === 10;
};

const validateEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

const validateAmount = (amount) => {
  const num = Number(amount);
  return !isNaN(num) && num > 0 && num <= 10000000; // Max 1 lakh rupees
};

const validateUUID = (uuid) => {
  if (!uuid) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// Timing-safe hex compare to verify HMAC signatures without leaking timing information
function safeCompareHex(a, b) {
  try {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) {
    // Fallback: if something goes wrong (non-hex input), use strict equality
    return a === b;
  }
}

// Handle favicon.ico requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health check endpoint to verify database connection
app.get('/api/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('customers').select('count').limit(1);
    if (error) {
      return res.status(500).json({ 
        status: 'unhealthy', 
        database: 'disconnected',
        error: error.message,
        supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'MISSING',
        supabaseKey: process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'MISSING'
      });
    }
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      supabaseUrl: 'configured',
      supabaseKey: 'configured'
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      message: err.message,
      supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'MISSING',
      supabaseKey: process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'MISSING'
    });
  }
});

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ========================================
// DEBUG: Order verification endpoint
// ========================================
// Use this to verify the orders table schema and recent orders.
// Call: GET /api/debug/orders-check
app.get('/api/debug/orders-check', async (req, res) => {
  try {
    console.log('ðŸ” [DEBUG] Orders check endpoint hit');

    // 1. Check recent orders
    const { data: recentOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, customer_name, total_amount, status, payment_id, razorpay_order_id, delivery_slot, delivery_date, coupon_code, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // 2. Check recent pending orders
    const { data: pendingOrders, error: pendingError } = await supabase
      .from('pending_orders')
      .select('id, razorpay_order_id, customer_id, final_amount, status, delivery_slot, delivery_date, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // 3. Try inserting and deleting a test record to verify schema
    let schemaTest = { success: false, message: '' };
    const testRecord = {
      customer_id: '00000000-0000-0000-0000-000000000000',
      customer_name: '__SCHEMA_TEST__',
      customer_email: 'test@test.com',
      customer_phone: '0000000000',
      items: '[]',
      total_amount: 0,
      status: 'placed',
      payment_id: '__test_' + Date.now(),
      payment_method: 'test',
      delivery_slot: null,
      delivery_date: null,
      razorpay_order_id: '__test_' + Date.now(),
      coupon_code: null,
      coupon_discount: 0,
      is_subscription: false,
      placed_at: new Date().toISOString(),
      delivery_dates: '[]'
    };

    const { data: testInsert, error: testInsertError } = await supabase
      .from('orders')
      .insert([testRecord])
      .select()
      .single();

    if (testInsertError) {
      schemaTest = { 
        success: false, 
        message: testInsertError.message,
        code: testInsertError.code,
        details: testInsertError.details,
        hint: testInsertError.hint,
        missingColumns: 'Check the error above â€” it likely mentions a missing column. Run fix_orders_table_migration.sql in Supabase SQL Editor.'
      };
    } else {
      // Clean up test record
      await supabase.from('orders').delete().eq('id', testInsert.id);
      schemaTest = { success: true, message: 'All required columns exist. Schema is correct.' };
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      schemaTest,
      recentOrders: {
        count: (recentOrders || []).length,
        error: ordersError?.message || null,
        orders: recentOrders || []
      },
      pendingOrders: {
        count: (pendingOrders || []).length,
        error: pendingError?.message || null,
        orders: pendingOrders || []
      },
      config: {
        razorpayMode: razorpayKeyId?.startsWith('rzp_live_') ? 'LIVE' : 'TEST',
        razorpayKeyConfigured: !!razorpayKeyId,
        razorpaySecretConfigured: !!razorpayKeySecret,
        supabaseConfigured: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY
      }
    });
  } catch (error) {
    console.error('âŒ [DEBUG] Orders check failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// DEBUG: Verify a specific payment ID
// ========================================
app.get('/api/debug/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`ðŸ” [DEBUG] Checking payment status for: ${paymentId}`);

    // Check orders table
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, payment_id, total_amount, created_at')
      .eq('payment_id', paymentId)
      .single();

    // Check pending_orders table
    const { data: pendingOrder } = await supabase
      .from('pending_orders')
      .select('id, razorpay_order_id, status, final_amount, created_at')
      .eq('payment_id', paymentId)
      .single();

    // Check Razorpay
    let razorpayPayment = null;
    try {
      razorpayPayment = await razorpay.payments.fetch(paymentId);
    } catch (e) {
      razorpayPayment = { error: e.message };
    }

    res.json({
      success: true,
      paymentId,
      orderInDB: order || null,
      pendingOrderInDB: pendingOrder || null,
      razorpayStatus: razorpayPayment ? {
        status: razorpayPayment.status,
        amount: razorpayPayment.amount,
        method: razorpayPayment.method,
        error: razorpayPayment.error
      } : null,
      diagnosis: !order && razorpayPayment?.status === 'captured'
        ? 'âš ï¸ PAYMENT CAPTURED BUT NO ORDER IN DB â€” Order creation likely failed. Check server logs.'
        : order ? ' Order exists in database' : 'â„¹ï¸ No order found'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// DELIVERY SLOT CONFIGURATION & VALIDATION
// ========================================
const DELIVERY_SLOTS = {
  SLOT_12_2: '12:00 PM - 2:00 PM',
  SLOT_630_9: '6:30 PM - 9:00 PM',
  INSTANT: 'Instant Delivery'
};

const VALID_DELIVERY_SLOTS = [DELIVERY_SLOTS.SLOT_12_2, DELIVERY_SLOTS.SLOT_630_9, DELIVERY_SLOTS.INSTANT];

/**
 * Validate delivery slot.
 * Both slots are always available for fast-food orders.
 *
 * Returns { valid: true } or { valid: false, message: '...' }
 */
const validateDeliverySlot = (deliverySlot, cartItems) => {
  if (!deliverySlot || !VALID_DELIVERY_SLOTS.includes(deliverySlot)) {
    return { valid: false, message: 'Invalid delivery slot. Please select a valid slot.' };
  }

  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return { valid: false, message: 'Cart is empty.' };
  }

  return { valid: true };
};

/**
 * Validate delivery date is present and reasonable
 */
const validateDeliveryDate = (deliveryDate) => {
  if (!deliveryDate) {
    return { valid: false, message: 'Delivery date is required.' };
  }
  const date = new Date(deliveryDate);
  if (isNaN(date.getTime())) {
    return { valid: false, message: 'Invalid delivery date.' };
  }
  return { valid: true };
};

// ========================================
// PRODUCT CATALOG - SERVER-SIDE PRICE SOURCE
// ========================================
// This is the authoritative price list. All prices MUST come from here.
// If a product is not in this catalog, it cannot be purchased.
// Prices are in INR (Indian Rupees).

/**
 * Database-driven product lookup functions
 * All products now come from the menu_items table
 * Hardcoded PRODUCT_CATALOG has been removed (see migration script for legacy data)
 */
const getProductFromCatalog = async (productId, productType, vendorId) =>
  vendorCatalog.getProductFromCatalog(productId, vendorId, supabase);

const getProductByName = async (name, vendorId) =>
  vendorCatalog.getProductByName(name, vendorId, supabase);

// ========================================
// PRODUCT CATEGORIES
// ========================================

/**
 * Standard product categories for categorization and filtering
 * All menu items MUST use one of these predefined categories
 * Used for admin validation and customer UI filtering
 */
const VALID_CATEGORIES = [
  'Starters',
  'Biryani',
  'Noodles',
  'Fried Rice',
  'Manchurian',
  'Chinese',
  'South Indian',
  'North Indian',
  'Fast Food',
  'Beverages',
  'Desserts',
  'Most Selling'
];

/**
 * Validates that a category is in the standard list
 * @param {string} category - The category name to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const validateCategory = (category) => {
  if (!category || typeof category !== 'string') {
    return false;
  }
  return VALID_CATEGORIES.includes(category.trim());
};

// ========================================
// SECURITY: AUTHENTICATION MIDDLEWARE
// ========================================

/**
 * CRITICAL: Authentication Middleware
 * Verifies Supabase JWT tokens from Authorization header
 * DENY-BY-DEFAULT: All requests without valid tokens are rejected
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized', 
        message: 'No authentication token provided' 
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized', 
        message: 'Invalid or expired token' 
      });
    }

    // Attach verified user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized', 
      message: 'Authentication failed' 
    });
  }
};

/**
 * CRITICAL: Role-Based Authorization Middleware
 * Verifies user role from Supabase user metadata
 * MUST be used after authenticateToken
 */
const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          success: false, 
          error: 'Unauthorized', 
          message: 'Authentication required' 
        });
      }

      // Get user role from Supabase metadata
      const userRole = req.user.user_metadata?.role || req.user.app_metadata?.role;

      if (!userRole) {
        return res.status(403).json({ 
          success: false, 
          error: 'Forbidden', 
          message: 'User role not configured' 
        });
      }

      // Check if user has required role
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ 
          success: false, 
          error: 'Forbidden', 
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
        });
      }

      // Attach role to request for downstream use
      req.userRole = userRole;
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(403).json({ 
        success: false, 
        error: 'Forbidden', 
        message: 'Authorization failed' 
      });
    }
  };
};

/**
 * CRITICAL: Customer Order Access Control
 * Ensures customers can ONLY access their own orders
 */
const requireOwnOrder = async (req, res, next) => {
  try {
    const customerId = req.params.customerId || req.body.customerId;
    
    // Get user role from Supabase metadata (since requireRole may not have run)
    const userRole = req.userRole || req.user?.user_metadata?.role || req.user?.app_metadata?.role;
    
    // Admin and Partner can access all orders
    if (userRole === 'admin' || userRole === 'partner') {
      req.userRole = userRole;
      return next();
    }

    // Customer can only access their own orders
    if (userRole === 'customer') {
      // Verify customer ID matches authenticated user
      if (customerId !== req.user.id) {
        return res.status(403).json({ 
          success: false, 
          error: 'Forbidden', 
          message: 'You can only access your own orders' 
        });
      }
      req.userRole = userRole;
      return next();
    }

    // If no role found, default to checking if user ID matches customer ID (for customers without role metadata)
    if (req.user && customerId === req.user.id) {
      req.userRole = 'customer';
      return next();
    }

    return res.status(403).json({ 
      success: false, 
      error: 'Forbidden', 
      message: 'Invalid user role or access denied' 
    });
  } catch (error) {
    console.error('Order access control error:', error);
    return res.status(403).json({ 
      success: false, 
      error: 'Forbidden', 
      message: 'Access control failed' 
    });
  }
};

// Email Credentials Validation
// Validate email credentials at startup before server starts
console.log('Initializing Email Service...');
try {
  validateEmailCredentials();
  console.log('✓ Email credentials validated');
} catch (error) {
  console.error('CRITICAL: Email configuration failed:', error.message);
  console.error('  → Check EMAIL_USER and EMAIL_PASS in .env');
  process.exit(1);
}

// Razorpay Instance
// Always use the keys from .env — do NOT auto-swap to test keys based on hostname.
// Changing the key between order creation and checkout opening causes a 500 from Razorpay.
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

console.log('Initializing Razorpay...');
const isLocalhost = !process.env.VERCEL && (process.env.NODE_ENV !== 'production');
console.log('Environment:', isLocalhost ? 'LOCALHOST' : 'PRODUCTION');

if (!razorpayKeyId || !razorpayKeySecret) {
  console.error('CRITICAL: Razorpay credentials not configured! Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});

const razorpayMode = razorpayKeyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
if (isLocalhost && razorpayMode === 'LIVE') {
  console.warn(
    '⚠️  Localhost is using LIVE Razorpay keys. Add NIVA-Backend/.env.local with rzp_test_* keys (see .env.example).'
  );
}
console.log(`Razorpay initialized in ${razorpayMode} mode with key: ${razorpayKeyId.substring(0, 16)}...`);

app.use(
  '/api/vendors',
  createVendorRouter({ supabase, razorpay, razorpayKeyId })
);

// Common NIVA Footer for all emails - function to generate unique content per email
// This prevents Gmail from collapsing/trimming the footer as "quoted text"
const getNivaEmailFooter = () => {
  const uniqueId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  return `
              <div style="margin-top: 30px; padding-top: 25px; border-top: 2px solid #E5E7EB;">
                <h3 style="margin: 0 0 15px 0; color: #16A34A; text-align: center;">Stay Connected with NIVA </h3>
              
                <div style="background-color: #F0FDF4; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: center;">
                  <p style="margin: 0 0 8px 0;">Join our official WhatsApp Channel for updates &amp; offers:</p>
                  <a href="https://whatsapp.com/channel/0029VbCQhdxId7nKq0tZEf3v" style="color: #16A34A; font-weight: bold; text-decoration: underline;">https://whatsapp.com/channel/0029VbCQhdxId7nKq0tZEf3v</a>
                </div>
                
                <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: center;">
                  <p style="margin: 0 0 10px 0; font-weight: bold;">Thank you for ordering with us!</p>
                  <p style="margin: 0 0 5px 0;">For Room Deliveries(Boys): <strong>9876027082</strong></p>
                  <p style="margin: 0 0 5px 0;">For Room Deliveries(Girls): <strong>9618263400</strong></p>
                  <p style="margin: 0 0 0 0;">For Any Issues: <strong>9392178949</strong></p>
                </div>
                
                <p style="text-align: center; color: #6B7280; margin: 15px 0 5px 0;">Thank you for choosing <strong>NIVA</strong></p>
                <p style="text-align: center; color: #6B7280; margin: 0; font-weight: bold;">Team NIVA</p>
              </div>
              <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;opacity:0;">&#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; ${uniqueId}</div>`;
};
// Keep backward compat reference
const nivaEmailFooter = getNivaEmailFooter();

// Email HTML wrapper - generates complete HTML with inline styles (no <style> block)
// This prevents Gmail from clipping/trimming by reducing email size and avoiding repeated style blocks
const generateEmailHTML = (headerBg, headerTitle, headerSubtitle, bodyContent) => {
  const uid = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: ${headerBg}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
<h1 style="margin: 0; font-size: 24px;">${headerTitle}</h1>
${headerSubtitle ? `<p style="margin: 5px 0 0 0; font-size: 14px;">${headerSubtitle}</p>` : ''}
</div>
<div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
${bodyContent}
${getNivaEmailFooter()}
</div>
</div>
<div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;opacity:0;">${uid}</div>
</body>
</html>`;
};

// Email Templates
const emailTemplates = {
  orderPlaced: {
    customer: (orderData) => ({
      subject: 'Your Order Has Been Placed Successfully | NIVA',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Your Order Has Been Placed Successfully</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hi <strong>${orderData.customer_name}</strong>,</p>
              <p>Thank you for your order! We've successfully received your request and our team is preparing it.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;">Order Details</h3>
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Order Date:</strong> ${new Date().toLocaleString('en-IN')}</p>
                <p><strong>Payment Method:</strong> ${orderData.payment_method || 'Online Payment'}</p>
                <p><strong>Delivery Address:</strong> ${orderData.customer_college || 'N/A'}</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Order Summary</h3>
                ${orderData.items.map(item => `
                  <div style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Quantity: ${item.quantity} | Price: Rs. ${item.price}</span>
                  </div>
                `).join('')}
                <p style="margin-top: 15px; font-size: 16px;"><strong>Total Amount Paid: Rs. ${orderData.total_amount}</strong></p>
              </div>
              
              <p>We'll notify you once a delivery partner accepts your order.</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    admin: (orderData) => ({
      subject: `New Order Placed | NIVA | #${orderData.orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">New Order Placed</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>A new order has been placed.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;">Customer &amp; Order Info</h3>
                <p><strong>Customer Name:</strong> ${orderData.customer_name}</p>
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Phone:</strong> ${orderData.customer_phone || 'N/A'}</p>
                <p><strong>Address:</strong> ${orderData.customer_college || 'N/A'}</p>
                <p><strong>Payment:</strong> ${orderData.payment_method || 'Online Payment'}</p>
                <p><strong>Total:</strong> Rs. ${orderData.total_amount}</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Items</h3>
                ${orderData.items.map(item => `
                  <div style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Qty: ${item.quantity} | Price: Rs. ${item.price} | Subtotal: Rs. ${item.price * item.quantity}</span>
                  </div>
                `).join('')}
              </div>
              
              <p><strong>Order Time:</strong> ${new Date().toLocaleString('en-IN')}</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    partner: (orderData) => ({
      subject: ` New Delivery Available - #${orderData.orderId} | NIVA`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">New Delivery Order Available</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hello,</p>
              <p>A new order is ready for delivery. Login to your partner dashboard to accept this order.</p>
              
              <div style="background-color: #D1FAE5; border-left: 4px solid #059669; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <p style="margin: 0; font-weight: bold; color: #065F46;">First to accept gets the order!</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Order Summary</h3>
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Delivery Location:</strong> ${orderData.customer_college}</p>
                <p><strong>Amount:</strong> Rs. ${orderData.total_amount}</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Items to Deliver</h3>
                ${orderData.items.map(item => `
                  <div style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''} - Qty: ${item.quantity}
                  </div>
                `).join('')}
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    })
  },
  
  orderTaken: {
    customer: (orderData) => ({
      subject: 'Your Order is Confirmed & Being Prepared | NIVA',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Order Confirmed &amp; Being Prepared</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hi <strong>${orderData.customer_name}</strong>,</p>
              <p><strong>Good news!</strong></p>
              <p>Your order <strong>#${orderData.orderId}</strong> has been accepted by our delivery partner and is now being prepared.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Items Ordered</h3>
                ${orderData.items ? orderData.items.map(item => `
                  <div style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Quantity: ${item.quantity} | Price: Rs. ${item.price}</span>
                  </div>
                `).join('') : '<p>Order items confirmed</p>'}
              </div>
              
              <p>We'll notify you once your order is out for delivery.</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    admin: (orderData) => ({
      subject: `Order Accepted by Partner | NIVA | #${orderData.orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Order Accepted by Partner</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Order <strong>#${orderData.orderId}</strong> has been accepted by the delivery partner.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Order Info</h3>
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Phone:</strong> ${orderData.customer_phone || 'N/A'}</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Items</h3>
                ${orderData.items ? orderData.items.map(item => `
                  <div style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Qty: ${item.quantity} | Price: Rs. ${item.price}</span>
                  </div>
                `).join('') : '<p>Order items confirmed</p>'}
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    partner: (orderData) => ({
      subject: `Order #${orderData.orderId} Confirmed - Ready for Delivery | NIVA`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Order Accepted Successfully</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hello,</p>
              <p>You have successfully accepted this order. Please prepare for delivery.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Delivery Details</h3>
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Location:</strong> ${orderData.customer_college}</p>
                <p><strong>Customer Phone:</strong> ${orderData.customer_phone}</p>
                <p><strong>Amount to Collect:</strong> Rs. ${orderData.total_amount}</p>
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    })
  },
  
  orderOutForDelivery: {
    customer: (orderData) => ({
      subject: 'Your Order is Out for Delivery | NIVA',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Your Order is Out for Delivery</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hi <strong>${orderData.customer_name}</strong>,</p>
              <p>Your order <strong>#${orderData.orderId}</strong> is now out for delivery.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Your Order</h3>
                ${orderData.items ? orderData.items.map(item => `
                  <div style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Quantity: ${item.quantity} | Price: Rs. ${item.price}</span>
                  </div>
                `).join('') : ''}
                <p style="margin-top: 10px;"><strong>Total: Rs. ${orderData.total_amount}</strong></p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;">Delivery Address</h3>
                <p>${orderData.customer_college || 'Your registered address'}</p>
              </div>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;">Contact Us</h3>
                <p> For Room Deliveries(Boys): <strong>9876027082</strong></p>
                <p>ðŸŽ For Room Deliveries(Girls): <strong>9618263400</strong></p>
                <p> For Any Issues: <strong>9392178949</strong></p>
              </div>
              
              <p>Please keep your phone available.</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    admin: (orderData) => ({
      subject: `Order Out for Delivery | NIVA | #${orderData.orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Order Out for Delivery</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Order <strong>#${orderData.orderId}</strong> is out for delivery.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Phone:</strong> ${orderData.customer_phone || 'N/A'}</p>
                <p><strong>Address:</strong> ${orderData.customer_college || 'N/A'}</p>
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    partner: (orderData) => ({
      subject: `Order #${orderData.orderId} - Out for Delivery | NIVA`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Delivery in Progress</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hello,</p>
              <p>Order marked as out for delivery. Safe travels!</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Location:</strong> ${orderData.customer_college}</p>
                <p><strong>Phone:</strong> ${orderData.customer_phone}</p>
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    })
  },
  
  orderDelivered: {
    customer: (orderData) => ({
      subject: 'Your Order Has Been Delivered | NIVA',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Your Order Has Been Delivered</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hi <strong>${orderData.customer_name}</strong>,</p>
              <p>Your order <strong>#${orderData.orderId}</strong> has been successfully delivered.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111;"> Your Order</h3>
                ${orderData.items ? orderData.items.map(item => `
                  <div style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">
                    <strong>${item.name}</strong> ${item.type ? `(${item.type})` : ''}<br>
                    <span style="color: #6B7280;">Quantity: ${item.quantity} | Price: Rs. ${item.price}</span>
                  </div>
                `).join('') : ''}
                <p style="margin-top: 10px;"><strong>Total: Rs. ${orderData.total_amount}</strong></p>
              </div>
              
              <p>We hope you enjoy your meal!</p>
              <p>If you loved your experience, we'd appreciate your review.</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    admin: (orderData) => ({
      subject: `Order Delivered Successfully | NIVA | #${orderData.orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Order Delivered Successfully</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Order <strong>#${orderData.orderId}</strong> has been delivered successfully.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Phone:</strong> ${orderData.customer_phone || 'N/A'}</p>
                <p><strong>Total:</strong> Rs. ${orderData.total_amount}</p>
              </div>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    }),
    partner: (orderData) => ({
      subject: `Order #${orderData.orderId} - Delivery Completed | NIVA`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000000; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">NIVA</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px;">Delivery Completed</p>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
              <p>Hello,</p>
              <p>Great job! You have successfully completed the delivery.</p>
              
              <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #059669;"> Delivery Summary</h3>
                <p><strong>Order ID:</strong> #${orderData.orderId}</p>
                <p><strong>Customer:</strong> ${orderData.customer_name}</p>
                <p><strong>Amount Collected:</strong> Rs. ${orderData.total_amount}</p>
                <p><strong>Completed At:</strong> ${new Date().toLocaleString('en-IN')}</p>
              </div>
              
              <p style="text-align: center; font-size: 18px;">Thank you for your excellent service!</p>
              
              ${getNivaEmailFooter()}
            </div>
          </div>
        </body>
        </html>
      `
    })
  }
};

// Helper function to send emails to all stakeholders
async function sendEmailsToAll(templateType, orderData) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  const partnerEmail = process.env.PARTNER_EMAIL;
  
  const templates = emailTemplates[templateType];
  const transporter = getTransporter();
  
  try {
    // Send to customer
    if (orderData.customer_email) {
      const customerEmail = templates.customer(orderData);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: orderData.customer_email,
        subject: customerEmail.subject,
        html: customerEmail.html
      });
      console.log(` Customer email sent for ${templateType}`);
    }
    
    // Send to admin
    const adminEmailTemplate = templates.admin(orderData);
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: adminEmailTemplate.subject,
      html: adminEmailTemplate.html
    });
    console.log(` Admin email sent for ${templateType}`);
    
    // Send to partner
    if (partnerEmail) {
      const partnerEmailTemplate = templates.partner(orderData);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: partnerEmail,
        subject: partnerEmailTemplate.subject,
        html: partnerEmailTemplate.html
      });
      console.log(` Partner email sent for ${templateType}`);
    }
  } catch (error) {
    console.error(`âŒ Error sending emails for ${templateType}:`, error.message);
  }
}

registerOrderPlacedNotifier(async (order, meta = {}) => {
  try {
    const items =
      typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [];
    await sendEmailsToAll('orderPlaced', {
      orderId: String(order.id).slice(0, 8).toUpperCase(),
      customer_name: order.customer_name || 'Customer',
      customer_email: order.customer_email || '',
      customer_phone: order.customer_phone || '',
      customer_college: order.customer_college || '',
      total_amount: order.total_amount,
      items: Array.isArray(items) ? items : [],
      payment_method: order.payment_method || 'razorpay',
      partner_phone: 'Contact Soon',
      source: meta.source || 'payment',
    });
  } catch (e) {
    console.error('[NOTIFY] registerOrderPlacedNotifier:', e.message);
  }
});

// Routes

// Create or update customer record (bypasses RLS using service key)
app.post('/api/customers/upsert', async (req, res) => {
  try {
    const { id, name, email, phone, college } = req.body;
    
    console.log('Customer upsert request:', { id, email, name, phone: phone ? 'provided' : 'empty' });
    
    if (!id || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields: id and email' });
    }
    
    // Check if supabase is initialized
    if (!supabase) {
      console.error('Supabase client not initialized');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    // First check if a record exists with this ID or email
    const { data: existing, error: fetchError } = await supabase
      .from('customers')
      .select('*')
      .or(`id.eq.${id},email.eq.${email}`)
      .maybeSingle();
    
    if (fetchError) {
      console.error('Error fetching existing customer:', fetchError);
      return res.status(500).json({ success: false, message: 'Database query failed: ' + fetchError.message });
    }
    
    let data, error;
    
    if (existing) {
      // Update existing record - preserve phone and college if not provided or empty
      const updateData = {
        name: name || existing.name || email.split('@')[0],
        email
      };
      
      // Only update phone if a non-empty value is provided
      if (phone && phone.trim() !== '') {
        updateData.phone = phone;
      }
      
      // Only update college if a non-empty value is provided
      if (college && college.trim() !== '') {
        updateData.college = college;
      }
      
      const updateResult = await supabase
        .from('customers')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();
      
      data = updateResult.data;
      error = updateResult.error;
    } else {
      // Insert new record
      const insertResult = await supabase
        .from('customers')
        .insert([
          { 
            id,
            name: name || email.split('@')[0],
            email,
            phone: phone || '',
            college: college || ''
          }
        ])
        .select()
        .single();
      
      data = insertResult.data;
      error = insertResult.error;
    }
    
    if (error) {
      console.error('Error upserting customer:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in customer upsert:', error);
    res.status(500).json({ success: false, message: 'Failed to create/update customer record' });
  }
});

// Update customer profile (bypasses RLS using service key)
app.put('/api/customers/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, college } = req.body;
    
    if (!id) {
      return res.status(400).json({ success: false, message: 'Missing customer ID' });
    }
    
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (college !== undefined) updateData.college = college;
    
    const { data, error } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating customer:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    
    if (!data) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in customer update:', error);
    res.status(500).json({ success: false, message: 'Failed to update customer record' });
  }
});

// Get customer by ID (bypasses RLS using service key)
app.get('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ success: false, message: 'Missing customer ID' });
    }
    
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching customer:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in customer fetch:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customer record' });
  }
});

// Admin OTP Login via Email
app.post('/api/admin/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Verify admin email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (email !== adminEmail) {
      return res.status(403).json({ success: false, message: 'Unauthorized email address' });
    }
    
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    
    // Store OTP in database with expiry (5 minutes)
    const { data, error } = await supabase
      .from('admin_otp')
      .insert([
        { 
          email: email, 
          otp: otp,
          expires_at: new Date(Date.now() + 5 * 60000).toISOString()
        }
      ]);
    
    if (error) throw error;
    
    // Send OTP via Email
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Admin Login OTP - Fruit Bowl Delivery',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #7c3aed; text-align: center; margin-bottom: 20px;">Admin Login OTP</h2>
            <p style="color: #333; font-size: 16px;">Your One-Time Password for admin login is:</p>
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-size: 36px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 30px 0;">
              ${otp}
            </div>
            <p style="color: #666; font-size: 14px; margin-top: 20px;"> This OTP is valid for <strong>5 minutes</strong> only.</p>
            <p style="color: #666; font-size: 14px;"> If you didn't request this OTP, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">Fruit Bowl Delivery Admin System</p>
          </div>
        </div>
      `
    });
    
    console.log(`OTP sent to ${email}: ${otp}`);
    
    res.json({ success: true, message: 'OTP sent successfully to your email. Please check your inbox.' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});

app.post('/api/admin/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    const { data, error } = await supabase
      .from('admin_otp')
      .select('*')
      .eq('email', email)
      .eq('otp', otp)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !data) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }
    
    // Delete used OTP
    await supabase.from('admin_otp').delete().eq('id', data.id);
    
    res.json({ success: true, message: 'Login successful', role: 'admin' });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// Partner Login (Database check with bcrypt)
app.post('/api/partner/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'Phone and password required' });
    }
    
    const { data: partner, error } = await supabase
      .from('partners')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();
    
    if (error) {
      console.error('Error checking partner credentials:', error);
      return res.status(500).json({ success: false, message: 'Login failed' });
    }
    
    if (!partner) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if partner is active
    if (partner.active === false) {
      return res.status(401).json({ success: false, message: 'Account is deactivated. Contact admin.' });
    }

    // Compare password - support both bcrypt hashed and plain text (legacy)
    let passwordMatch = false;
    if (partner.password.startsWith('$2')) {
      // bcrypt hashed password
      passwordMatch = await bcrypt.compare(password, partner.password);
    } else {
      // Plain text password (legacy support)
      passwordMatch = (partner.password === password);
    }

    if (passwordMatch) {
      // Don't expose password in response
      const { password: _, ...partnerData } = partner;
      res.json({ success: true, message: 'Login successful', role: 'partner', partner: partnerData });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Error in partner login:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Get all partners (Admin)
// SECURITY: Protected - Only authenticated Admins can view partners
app.get('/api/admin/partners', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('partners')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, partners: data });
  } catch (error) {
    console.error('Error fetching partners:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch partners' });
  }
});

// Create partner (Admin)
// SECURITY: Protected - Only authenticated Admins can create partners
// Creates both Supabase Auth user and partners table entry
app.post('/api/admin/partners', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    
    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Name, phone and password required' });
    }
    
    // Check if phone already exists
    const { data: existing } = await supabase
      .from('partners')
      .select('phone')
      .eq('phone', phone)
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ success: false, message: 'Partner with this phone already exists' });
    }

    // Create Supabase Auth user â€” Supabase handles password hashing internally
    const partnerEmail = `${phone}@partner.com`;
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: partnerEmail,
      password: password, // Plain text â€” Supabase hashes internally
      email_confirm: true,
      user_metadata: { name, phone, role: 'partner' },
      app_metadata: { role: 'partner' }
    });

    if (authError) {
      console.error('Error creating Supabase Auth user for partner:', authError);
      return res.status(500).json({ success: false, message: 'Failed to create partner auth account' });
    }

    // Insert into partners table (try with supabase_id, fallback without)
    const insertData = { 
      name, 
      phone, 
      password: password, // Plain text for legacy backend route
      hide_prices: false,
      lunch_slot_active: true,
      evening_slot_active: true,
      active: true,
      role: 'partner'
    };

    let data, error;
    ({ data, error } = await supabase
      .from('partners')
      .insert([{ ...insertData, supabase_id: authData.user.id }])
      .select()
      .single());

    if (error && error.message && error.message.includes('supabase_id')) {
      // Column doesn't exist yet â€” insert without it
      ({ data, error } = await supabase
        .from('partners')
        .insert([insertData])
        .select()
        .single());
    }
    
    if (error) throw error;
    
    // Don't expose password in response
    const { password: _, ...partnerData } = data;
    res.json({ success: true, partner: partnerData });
  } catch (error) {
    console.error('Error creating partner:', error);
    res.status(500).json({ success: false, message: 'Failed to create partner' });
  }
});

// Update partner (Admin)
// SECURITY: Protected - Only authenticated Admins can update partners
app.put('/api/admin/partners/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, password } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (password) updateData.password = password;
    
    const { data, error } = await supabase
      .from('partners')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, partner: data });
  } catch (error) {
    console.error('Error updating partner:', error);
    res.status(500).json({ success: false, message: 'Failed to update partner' });
  }
});

// Delete partner (Admin)
// SECURITY: Protected - Only authenticated Admins can delete partners
app.delete('/api/admin/partners/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('partners')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Partner deleted successfully' });
  } catch (error) {
    console.error('Error deleting partner:', error);
    res.status(500).json({ success: false, message: 'Failed to delete partner' });
  }
});

// ========================================
// PARTNER PROFILE & SLOT CONTROL APIs
// ========================================

// Get partner profile by phone (for partner dashboard)
app.get('/api/partner/profile', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const userPhone = req.user.user_metadata?.phone || req.query.phone;
    
    if (!userPhone) {
      return res.status(400).json({ success: false, message: 'Phone number required' });
    }

    const { data: partner, error } = await supabase
      .from('partners')
      .select('id, name, phone, hide_prices, lunch_slot_active, evening_slot_active, lunch_room_delivery_active, evening_room_delivery_active, fast_foods_active, biryani_active, active, role, created_at')
      .eq('phone', userPhone)
      .maybeSingle();

    if (error) throw error;

    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    res.json({ success: true, partner });
  } catch (error) {
    console.error('Error fetching partner profile:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch partner profile' });
  }
});

// Update partner slot control (Partner toggles slots on/off, room delivery, stock)
app.put('/api/partner/slot-control', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const userPhone = req.user.user_metadata?.phone || req.body.phone;
    const { lunchSlotActive, eveningSlotActive, lunchRoomDeliveryActive, eveningRoomDeliveryActive, fastFoodsActive, biryaniActive } = req.body;
    
    if (!userPhone) {
      return res.status(400).json({ success: false, message: 'Phone number required' });
    }

    const updateData = {};
    if (typeof lunchSlotActive === 'boolean') updateData.lunch_slot_active = lunchSlotActive;
    if (typeof eveningSlotActive === 'boolean') updateData.evening_slot_active = eveningSlotActive;
    if (typeof lunchRoomDeliveryActive === 'boolean') updateData.lunch_room_delivery_active = lunchRoomDeliveryActive;
    if (typeof eveningRoomDeliveryActive === 'boolean') updateData.evening_room_delivery_active = eveningRoomDeliveryActive;
    if (typeof fastFoodsActive === 'boolean') updateData.fast_foods_active = fastFoodsActive;
    if (typeof biryaniActive === 'boolean') updateData.biryani_active = biryaniActive;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'No control data provided' });
    }

    const { data, error } = await supabase
      .from('partners')
      .update(updateData)
      .eq('phone', userPhone)
      .select('id, name, phone, lunch_slot_active, evening_slot_active, lunch_room_delivery_active, evening_room_delivery_active, fast_foods_active, biryani_active')
      .single();

    if (error) throw error;

    console.log(`Slot/stock control updated for ${userPhone}:`, updateData);
    res.json({ success: true, partner: data, message: 'Controls updated successfully' });
  } catch (error) {
    console.error('Error updating slot control:', error);
    res.status(500).json({ success: false, message: 'Failed to update controls' });
  }
});

// Get slot availability (Public - for customer checkout)
app.get('/api/slot-availability', async (req, res) => {
  try {
    // Get all active partners and their controls
    const { data: partners, error } = await supabase
      .from('partners')
      .select('lunch_slot_active, evening_slot_active, lunch_room_delivery_active, evening_room_delivery_active, fast_foods_active, biryani_active')
      .eq('active', true);

    if (error) throw error;

    let lunchSlotActive = true;
    let eveningSlotActive = true;
    let lunchRoomDeliveryActive = true;
    let eveningRoomDeliveryActive = true;
    let fastFoodsActive = true;
    let biryaniActive = true;

    if (partners && partners.length > 0) {
      lunchSlotActive = partners.some(p => p.lunch_slot_active !== false);
      eveningSlotActive = partners.some(p => p.evening_slot_active !== false);
      lunchRoomDeliveryActive = partners.some(p => p.lunch_room_delivery_active !== false);
      eveningRoomDeliveryActive = partners.some(p => p.evening_room_delivery_active !== false);
      fastFoodsActive = partners.some(p => p.fast_foods_active !== false);
      biryaniActive = partners.some(p => p.biryani_active !== false);
    }

    res.json({
      success: true,
      slots: {
        lunchSlotActive,
        eveningSlotActive,
        lunchRoomDeliveryActive,
        eveningRoomDeliveryActive
      },
      stock: {
        fastFoodsActive,
        biryaniActive
      }
    });
  } catch (error) {
    console.error('Error fetching slot availability:', error);
    res.json({
      success: true,
      slots: { lunchSlotActive: true, eveningSlotActive: true, lunchRoomDeliveryActive: true, eveningRoomDeliveryActive: true },
      stock: { fastFoodsActive: true, biryaniActive: true }
    });
  }
});

// Get all orders (Admin)
// SECURITY: CRITICAL - Protected - Only authenticated Admins can view all orders
app.get('/api/admin/orders', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    // Try with joins first (if foreign keys are configured)
    let data = null;
    let error = null;

    const joinResult = await supabase
      .from('orders')
      .select(`
        *,
        customers (name, email, phone, address),
        delivery_partners (name, phone)
      `)
      .order('created_at', { ascending: false });

    data = joinResult.data;
    error = joinResult.error;

    // Fallback: simple select without joins (if FK relationships don't exist)
    if (error) {
      console.warn('[ADMIN ORDERS] Join query failed, falling back to simple select:', error.message);
      const simpleResult = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      data = simpleResult.data;
      error = simpleResult.error;
      if (error) throw error;
    }

    console.log(`[ADMIN ORDERS] Returning ${(data || []).length} orders`);
    res.json({ success: true, orders: data });
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
});

// Get dashboard stats (Admin)
//chnaged the security
// SECURITY: Protected - Only authenticated Admins can view stats
app.get('/api/admin/stats', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*');
    const { data: customers } = await supabase.from('customers').select('*');
    
    const totalRevenue = orders.reduce((sum, order) => sum + (order.amount || 0), 0);
    
    res.json({
      success: true,
      stats: {
        totalOrders: orders.length,
        totalCustomers: customers.length,
        totalRevenue
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});


// Get partner deliveries
// SECURITY: Protected - Only authenticated Partners/Admins can view deliveries
app.get('/api/partner/deliveries', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        *,
        orders (
          *,
          customers (name, email, phone, address)
        )
      `)
      .eq('delivery_date', today)
      .order('created_at', { ascending: false});
    
    if (error) throw error;
    
    res.json({ success: true, deliveries: data });
  } catch (error) {
    console.error('Error fetching deliveries:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch deliveries' });
  }
});

// Get partner orders (NEW)
// SECURITY: Protected - Only authenticated Partners/Admins can view orders
// Partners only see ROOM delivery orders (normal delivery is restaurant-only).
app.get('/api/partner/orders', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    // Partners see only room-delivery orders at actionable statuses.
    const PARTNER_VISIBLE_STATUSES = [
      'placed',           // room delivery order not yet taken
      'pending',          // room delivery order not yet taken (alternate initial state)
      'taken',            // partner has taken the order
      'out_for_delivery', // partner en route
      'delivered'         // completed
    ];

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('delivery_type', 'room')
      .in('status', PARTNER_VISIBLE_STATUSES)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Normalise 'pending' (legacy) → treat same as 'placed' for display
    const parsedOrders = (data || []).map(order => {
      let items = order.items;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (e) { items = []; }
      }
      // Room delivery orders created via online payment used to be saved with
      // status='pending' (now fixed to 'placed'). Normalise here so the partner
      // dashboard always sees them as 'placed'.
      const displayStatus = order.status === 'pending' ? 'placed' : order.status;
      return { ...order, items, status: displayStatus };
    });

    console.log(`[PARTNER ORDERS] Returning ${parsedOrders.length} room-delivery orders`);
    res.json({ success: true, orders: parsedOrders });
  } catch (error) {
    console.error('Error fetching partner orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
});

// ========================================
// PARTNER SETTLEMENT API (Partner-only)
// Vendor pricing visible ONLY to partners
// ========================================

// Vendor food prices for settlement calculation (NEVER exposed to customers)
const VENDOR_PRICES = {
  'Veg Fried Rice': 59,
  'Veg Noodles': 59,
  'Veg Manchurian Fried Rice': 69,
  'Veg Manchurian': 59,
  'Egg Fried Rice': 69,
  'Egg Noodles': 69,
  'Chicken Fried Rice': 79,
  'Chicken Noodles': 79,
  'Chicken Manchurian': 99,
  'Dum Biryani': 120,
  'Fry Biryani': 130,
  // Noodle variants
  'Veg Manchurian Noodles': 69,
  // Starters
  'Chilli Chicken': 99,
  // Combos
  'Biryani Combo': 130,
  'Chicken Fried Rice + Thums Up Combo': 79,
  // Specials
  'Chicken Haleem': 199
};

// Room delivery partner payment based on total quantity
const calculateRoomDeliveryPartnerPayment = (totalQuantity) => {
  if (totalQuantity <= 2) return 20;
  if (totalQuantity <= 4) return 30;
  if (totalQuantity <= 6) return 35;
  if (totalQuantity <= 8) return 40;
  if (totalQuantity <= 10) return 45;
  return 45;
};

// Get settlement data (Partner-only)
app.get('/api/partner/settlement', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    // Fetch only delivered orders for settlement
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'delivered')
      .not('payment_id', 'is', null)
      .order('order_date', { ascending: false });

    if (error) throw error;

    // Calculate settlement per date
    const settlementByDate = {};

    for (const order of (orders || [])) {
      const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
      const orderDate = order.delivery_date || (order.order_date ? order.order_date.split('T')[0] : 'unknown');

      if (!settlementByDate[orderDate]) {
        settlementByDate[orderDate] = {
          date: orderDate,
          vendorTotal: 0,
          deliveryTotal: 0,
          websiteMaintenanceTotal: 0,
          codFeeTotal: 0,
          codFoodAmountTotal: 0,
          totalOrders: 0,
          orders: []
        };
      }

      // Calculate vendor earnings for this order
      let vendorEarnings = 0;
      const totalQty = items.reduce((sum, item) => sum + (parseInt(item.quantity) || 1), 0);

      for (const item of items) {
        const vendorPrice = VENDOR_PRICES[item.name] || 0;
        vendorEarnings += vendorPrice * (parseInt(item.quantity) || 1);
      }

      // Calculate room delivery partner payment
      let roomDeliveryPayment = parseFloat(order.partner_amount || 0);
      if (!roomDeliveryPayment && order.delivery_type === 'room') {
        roomDeliveryPayment = calculateRoomDeliveryPartnerPayment(totalQty);
      }

      const isCOD = order.payment_method === 'cod' || (order.delivery_type === 'room' && parseFloat(order.food_amount) > 0);
      const codFoodAmount = isCOD ? parseFloat(order.food_amount || 0) : 0;
      const codTax = isCOD ? Number((parseFloat(order.cod_tax) || (parseFloat(order.food_amount || 0) * 0.02)).toFixed(2)) : 0;
      
      let websiteMaintenance = parseFloat(order.maintenance_amount || 0);
      if (order.delivery_type === 'room') {
         websiteMaintenance = parseFloat(order.room_delivery_charge || 0) - roomDeliveryPayment;
      } else if (!websiteMaintenance && isCOD) {
         websiteMaintenance = parseFloat(order.total_amount || 0) - vendorEarnings - roomDeliveryPayment - codTax;
      }
      websiteMaintenance = Number(websiteMaintenance.toFixed(2));

      settlementByDate[orderDate].vendorTotal = Number((settlementByDate[orderDate].vendorTotal + vendorEarnings).toFixed(2));
      settlementByDate[orderDate].deliveryTotal = Number((settlementByDate[orderDate].deliveryTotal + roomDeliveryPayment).toFixed(2));
      settlementByDate[orderDate].websiteMaintenanceTotal = Number((settlementByDate[orderDate].websiteMaintenanceTotal + websiteMaintenance).toFixed(2));
      settlementByDate[orderDate].codFeeTotal = Number((settlementByDate[orderDate].codFeeTotal + codTax).toFixed(2));
      settlementByDate[orderDate].codFoodAmountTotal = Number((settlementByDate[orderDate].codFoodAmountTotal + codFoodAmount).toFixed(2));
      settlementByDate[orderDate].totalOrders += 1;
      settlementByDate[orderDate].orders.push({
        id: order.id,
        customerName: order.customer_name,
        items: items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          customerPrice: item.price,
          vendorPrice: VENDOR_PRICES[item.name] || 0
        })),
        vendorEarnings: Number(vendorEarnings.toFixed(2)),
        roomDeliveryPayment: Number(roomDeliveryPayment.toFixed(2)),
        websiteMaintenance: Number(websiteMaintenance.toFixed(2)),
        codTax: Number(codTax.toFixed(2)),
        deliveryType: order.delivery_type || 'normal',
        totalSettlement: Number((vendorEarnings + roomDeliveryPayment).toFixed(2)),
        orderDate: order.order_date,
        status: order.status
      });
    }

    // Convert to sorted array (newest first)
    const settlements = Object.values(settlementByDate).sort((a, b) => b.date.localeCompare(a.date));

    res.json({ success: true, settlements, vendorPrices: VENDOR_PRICES });
  } catch (error) {
    console.error('Error fetching settlement data:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch settlement data' });
  }
});

// Partner takes an order
// SECURITY: Protected - Only authenticated Partners/Admins can take orders
app.put('/api/partner/order/:id/take', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { partnerId, partnerName, partnerPhone } = req.body;
    
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: 'taken',
        partner_id: partnerId,
        partner_name: partnerName,
        partner_phone: partnerPhone,
        taken_at: now,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Send emails to customer, admin, and partner using new template system
    try {
      const orderData = {
        orderId: id.slice(0, 8).toUpperCase(),
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        customer_college: order.customer_college,
        total_amount: order.total_amount,
        partner_phone: partnerPhone,
        items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items
      };
      
      await sendEmailsToAll('orderTaken', orderData);
      
    } catch (emailError) {
      console.error('Failed to send emails for order taken:', emailError.message);
    }
    
    res.json({ success: true, message: 'Order taken successfully', order: data });
  } catch (error) {
    console.error('Error taking order:', error);
    res.status(500).json({ success: false, message: 'Failed to take order', error: error.message });
  }
});

// Partner marks order as out for delivery
// SECURITY: CRITICAL - Protected - Only authenticated Partners/Admins can mark orders out for delivery
app.put('/api/partner/order/:id/out-for-delivery', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: 'out_for_delivery',
        out_for_delivery_at: now,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Send emails to customer, admin, and partner using new template system
    try {
      const orderData = {
        orderId: id.slice(0, 8).toUpperCase(),
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        customer_college: order.customer_college,
        total_amount: order.total_amount,
        partner_phone: order.partner_phone,
        items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items
      };
      
      await sendEmailsToAll('orderOutForDelivery', orderData);
      } catch (emailError) {
        console.error('Failed to send emails for out for delivery:', emailError.message);
      }
    
    res.json({ success: true, message: 'Order marked as out for delivery', order: data });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ success: false, message: 'Failed to update order status', error: error.message });
  }
});

// Partner marks order as delivered
// SECURITY: CRITICAL - Protected - Only authenticated Partners/Admins can mark orders as delivered
app.put('/api/partner/order/:id/delivered', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: 'delivered',
        delivered_at: now,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Send emails to customer, admin, and partner using new template system
    try {
      const orderData = {
        orderId: id.slice(0, 8).toUpperCase(),
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        customer_college: order.customer_college,
        total_amount: order.total_amount,
        items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items
      };
      
      await sendEmailsToAll('orderDelivered', orderData);
    } catch (emailError) {
      console.error('Failed to send emails for delivered order:', emailError.message);
    }
    
    res.json({ success: true, message: 'Order delivered successfully', order: data });
  } catch (error) {
    console.error('Error delivering order:', error);
    res.status(500).json({ success: false, message: 'Failed to mark order as delivered', error: error.message });
  }
});

// Update delivery status
// SECURITY: Protected - Only authenticated Partners/Admins can update delivery status
app.put('/api/partner/delivery/:id/status', authenticateToken, requireRole('partner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const { data, error } = await supabase
      .from('deliveries')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`
        *,
        orders (
          customers (email, name)
        )
      `)
      .single();
    
    if (error) throw error;
    
    // Send email notification to customer
    const customer = data.orders?.customers;
    if (customer && customer.email && status === 'delivered') {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: customer.email,
        subject: 'Your Fruit Bowl Has Been Delivered!',
        html: `
          <h2>Delivery Completed</h2>
          <p>Hi ${customer.name},</p>
          <p>Your fruit bowl has been delivered successfully!</p>
          <p>Enjoy your fresh fruits. ðŸŽðŸŠðŸŒðŸ‡ðŸ“</p>
          <p>See you tomorrow!</p>
        `
      });
    }
    
    res.json({ success: true, delivery: data });
  } catch (error) {
    console.error('Error updating delivery:', error);
    res.status(500).json({ success: false, message: 'Failed to update delivery' });
  }
});

// Get daily menu
app.get('/api/menu/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('daily_menu')
      .select('*')
      .eq('date', today)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json({ success: true, menu: data || null });
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch menu' });
  }
});

// Razorpay Routes

// Test Razorpay connection
app.get('/api/payment/test', async (req, res) => {
  try {
    if (!razorpayKeyId || !razorpayKeySecret) {
      return res.status(500).json({
        success: false,
        error: 'Razorpay credentials not configured'
      });
    }
    
    const mode = razorpayKeyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
    
    res.json({
      success: true,
      message: 'Razorpay is configured',
      mode: mode,
      keyId: razorpayKeyId,
      keySecretSet: !!razorpayKeySecret,
      isLocalhost: isLocalhost
    });
  } catch (error) {
    console.error('Payment test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ============================================================================
 * SECURE PAYMENT ORDER CREATION
 * ============================================================================
 * 
 * SECURITY ARCHITECTURE:
 * 1. Frontend sends ONLY cart item IDs, product types, and quantities
 * 2. Backend fetches actual prices from Supabase database
 * 3. Backend calculates the total - client amount is NEVER trusted
 * 4. Razorpay order is created with server-calculated amount
 * 5. Pending order stored in DB with razorpay_order_id for verification
 * 
 * WHY THIS PREVENTS Rs. 1 MANIPULATION:
 * - The frontend cannot send a fake price
 * - All prices come from the database (source of truth)
 * - The razorpay_order_id is linked to the server-calculated amount
 * - Payment verification checks that paid amount matches order amount
 * ============================================================================
 */

// ============================================================================
// EXTERNAL ROOM DELIVERY (Swiggy/Zomato)
// ============================================================================
app.post('/api/orders/external-room-delivery', async (req, res) => {
  try {
    const { 
      customerId, 
      hostelType, 
      hostelName, 
      roomNumber, 
      numberOfPackets, 
      vendorPlatform, 
      paymentMethod,
      foodAmount,
      vendorOrderType,
      description,
      orderId,
      vendorCallReceived,
      codTax: frontendCodTax,
      penaltyFee: frontendPenaltyFee
    } = req.body;

    if (!customerId || !hostelType || !hostelName || !numberOfPackets || !vendorPlatform) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Delivery charge tiers (matches frontend roomDeliveryUtils.js)
    const calculateCharge = (packets) => {
      const count = parseInt(packets) || 0;
      if (count <= 2) return 29;
      if (count <= 4) return 49;
      if (count <= 6) return 55;
      if (count <= 8) return 59;
      return 69;
    };

    const calculatePartnerEarning = (packets) => {
      const count = parseInt(packets) || 0;
      if (count <= 2) return 20;
      if (count <= 4) return 30;
      if (count <= 6) return 38;
      if (count <= 8) return 42;
      return 50;
    };

    const serverCharge = calculateCharge(parseInt(numberOfPackets));
    const partnerAmount = calculatePartnerEarning(parseInt(numberOfPackets));
    
    // Server-side validation of penalty and COD tax
    const penaltyFee = vendorCallReceived ? 0 : 5;
    const finalFoodAmount = (vendorOrderType === 'cod') ? (parseFloat(foodAmount) || 0) : 0;
    const codTax = (vendorOrderType === 'cod') ? Number((finalFoodAmount * 0.02).toFixed(2)) : 0;
    
    const finalTotalAmount = serverCharge + finalFoodAmount + penaltyFee + codTax;
    const maintenanceAmount = serverCharge - partnerAmount;

    if (finalTotalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid order amount' });
    }

    // Get customer details
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (custError || !customer) {
      console.error('Customer lookup error:', custError?.message);
      return res.status(404).json({ success: false, message: 'Customer not found. Please ensure you are logged in.' });
    }

    const hostelTypeNormalized = hostelType === 'male' ? 'boys' : 'girls';
    const deliveryDesc = `${hostelName}${roomNumber ? ', Room ' + roomNumber : ''} (${vendorPlatform})`;

    const orderItems = [{
      name: `Room Delivery (${vendorPlatform}) - ${hostelName}${roomNumber ? ', Room ' + roomNumber : ''} - ${vendorOrderType === 'cod' ? 'Partner Pays at Gate' : 'Prepaid on Vendor'}`,
      quantity: parseInt(numberOfPackets),
      price: serverCharge,
      type: 'room_delivery',
      foodAmount: finalFoodAmount,
      description: description || ''
    }];

    if (paymentMethod === 'online') {
      // --- ONLINE: Create Razorpay order and store in pending_orders ---
      const razorpayOptions = {
        amount: Math.round(finalTotalAmount * 100),
        currency: 'INR',
        receipt: `ext_del_${Date.now()}`,
        notes: {
          customer_id: customerId,
          hostel: hostelName,
          room: roomNumber || 'N/A',
          platform: vendorPlatform,
          packets: numberOfPackets
        }
      };

      let razorpayOrder;
      try {
        razorpayOrder = await razorpay.orders.create(razorpayOptions);
      } catch (rzpError) {
        console.error('Razorpay order creation error:', rzpError.message);
        return res.status(500).json({ success: false, message: 'Payment gateway error. Please try again.' });
      }

      // Store in pending_orders - the /api/payment/verify route reads from here
      const pendingSettlement = JSON.stringify({
        deliveryCharge: serverCharge,
        partnerAmount,
        websiteMaintenance: serverCharge - partnerAmount,
        penaltyFee,
        codTax,
        foodAmount: finalFoodAmount,
        // Fallback storage until migration is applied
        vendor_platform: vendorPlatform,
        number_of_packets: parseInt(numberOfPackets),
      });

      const basePendingRecord = {
        razorpay_order_id: razorpayOrder.id,
        customer_id: customerId,
        items: JSON.stringify(orderItems),
        original_amount: finalTotalAmount,
        discount_amount: 0,
        final_amount: finalTotalAmount,
        coupon_code: null,
        delivery_slot: 'External Room Delivery - ' + deliveryDesc,
        delivery_date: new Date().toISOString().split('T')[0],
        delivery_type: 'room',
        hostel_type: hostelTypeNormalized,
        hostel_name: hostelName,
        room_number: roomNumber || null,
        room_delivery_charge: serverCharge,
        food_amount: finalFoodAmount,
        order_id: orderId || null,
        cod_tax: codTax,
        penalty_fee: penaltyFee,
        gate_confirmation: vendorCallReceived || false,
        partner_amount: partnerAmount,
        vendor_amount: 0,
        maintenance_amount: maintenanceAmount,
        settlement_breakdown: pendingSettlement,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };

      // Try with optional new columns first; fall back without them if not yet migrated
      let pending, pendingError;
      const pendingWithNewCols = { ...basePendingRecord, number_of_packets: parseInt(numberOfPackets), vendor_platform: vendorPlatform };
      ({ data: pending, error: pendingError } = await supabase.from('pending_orders').upsert(pendingWithNewCols, { onConflict: 'razorpay_order_id' }).select().single());

      if (pendingError && pendingError.code === 'PGRST204') {
        console.warn('[EXTERNAL-ORDER] number_of_packets/vendor_platform missing in pending_orders — run migration');
        ({ data: pending, error: pendingError } = await supabase.from('pending_orders').upsert(basePendingRecord, { onConflict: 'razorpay_order_id' }).select().single());
      }

      if (pendingError) {
        console.error('[EXTERNAL-ORDER] pending_orders failed:', pendingError.message);
        return res.status(500).json({
          success: false,
          message: 'Could not prepare payment. Please try again.',
          error_code: 'PENDING_ORDER_FAILED',
        });
      }

      console.log('External room delivery pending order created:', razorpayOrder.id, '| amount:', finalTotalAmount);

      return res.json({ 
        success: true, 
        orderId: pending?.id || null,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOptions.amount,
        key: razorpayKeyId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerCollege: customer.college
      });

    } else {
      // --- COD: Insert directly into orders ---
      // settlement_breakdown always carries vendor_platform + number_of_packets so data is never lost
      // even if the optional columns haven't been migrated yet in the DB.
      const settlementBreakdown = {
        deliveryCharge: serverCharge,
        partnerAmount,
        websiteMaintenance: serverCharge - partnerAmount,
        penaltyFee,
        codTax,
        foodAmount: finalFoodAmount,
        // Store here as fallback for partner dashboard until DB migration is applied
        vendor_platform: vendorPlatform,
        number_of_packets: parseInt(numberOfPackets),
      };

      const baseOrderRecord = {
        customer_id: customerId,
        customer_name: customer.name,
        customer_email: customer.email || '',
        customer_phone: customer.phone || '',
        customer_college: customer.college || '',
        items: JSON.stringify(orderItems),
        total_amount: finalTotalAmount,
        status: 'placed',
        placed_at: new Date().toISOString(),
        payment_method: 'cod',
        delivery_slot: 'External Room Delivery - ' + deliveryDesc,
        delivery_date: new Date().toISOString().split('T')[0],
        is_subscription: false,
        delivery_dates: '[]',
        delivery_type: 'room',
        hostel_type: hostelTypeNormalized,
        hostel_name: hostelName,
        room_number: roomNumber || null,
        room_delivery_charge: serverCharge,
        food_amount: finalFoodAmount,
        order_id: orderId || null,
        cod_tax: codTax,
        penalty_fee: penaltyFee,
        gate_confirmation: vendorCallReceived || false,
        partner_amount: partnerAmount,
        vendor_amount: 0,
        maintenance_amount: maintenanceAmount,
        settlement_breakdown: JSON.stringify(settlementBreakdown),
      };

      // Try inserting with optional new columns; fall back without them if not yet migrated
      let savedOrder, orderError;
      const withNewCols = { ...baseOrderRecord, number_of_packets: parseInt(numberOfPackets), vendor_platform: vendorPlatform };
      ({ data: savedOrder, error: orderError } = await supabase.from('orders').insert([withNewCols]).select().single());

      if (orderError && orderError.code === 'PGRST204') {
        // Columns don't exist yet — insert without them (data is in settlement_breakdown)
        console.warn('[EXTERNAL-ORDER] number_of_packets/vendor_platform columns missing — run add_room_delivery_columns.sql migration');
        ({ data: savedOrder, error: orderError } = await supabase.from('orders').insert([baseOrderRecord]).select().single());
      }

      if (orderError) {
        console.error('COD order insert error:', orderError.message, '|', orderError.details, '|', orderError.hint);
        return res.status(500).json({ success: false, message: 'Failed to create order. Please try again.' });
      }

      console.log('COD room delivery order created:', savedOrder.id, '| amount:', finalTotalAmount);
      return res.json({ success: true, orderId: savedOrder.id });
    }

  } catch (error) {
    console.error('Error creating external delivery order:', error.message);
    res.status(500).json({ success: false, message: 'Failed to create order. Please try again.' });
  }
});



// Create Razorpay order - SECURE VERSION
// Frontend must send: { cartItems: [{id, productType, quantity}], couponCode? }
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const {
      cartItems,
      couponCode,
      customerId,
      deliverySlot,
      deliveryDate,
      deliveryMode,
      deliveryType,
      hostelType,
      hostelName,
      roomNumber,
      roomDeliveryCharge,
      vendorId: bodyVendorId,
      vendor_id: bodyVendorIdSnake,
    } = req.body;

    const vendorId = bodyVendorId || bodyVendorIdSnake || vendorCatalog.DEFAULT_VENDOR_ID;

    const { data: vendorRow } = await supabase
      .from('vendors')
      .select('id, name, is_active')
      .eq('id', vendorId)
      .maybeSingle();

    if (!vendorRow || !vendorRow.is_active) {
      return res.status(400).json({
        success: false,
        message: 'This restaurant is not available right now.',
        error_code: 'VENDOR_UNAVAILABLE',
      });
    }

    const { data: vendorSettings } = await supabase
      .from('vendor_settings')
      .select('*')
      .eq('vendor_id', vendorId)
      .maybeSingle();

    if (vendorSettings?.is_open === false || vendorSettings?.accepting_orders === false) {
      return res.status(400).json({
        success: false,
        message: 'This restaurant is not accepting orders right now.',
        error_code: 'VENDOR_CLOSED',
      });
    }
    
    // ========================================================================
    // VALIDATION: Ensure cart items exist and have required fields
    // ========================================================================
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      console.error('SECURITY: Invalid cart items received');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid cart items. Please refresh and try again.' 
      });
    }

    // ========================================================================
    // VALIDATION: Delivery slot is required and must be valid for cart items
    // ========================================================================
    const slotValidation = validateDeliverySlot(deliverySlot, cartItems);
    if (!slotValidation.valid) {
      console.error('SECURITY: Invalid delivery slot:', deliverySlot);
      return res.status(400).json({
        success: false,
        message: slotValidation.message
      });
    }

    const dateValidation = validateDeliveryDate(deliveryDate);
    if (!dateValidation.valid) {
      console.error('SECURITY: Invalid delivery date:', deliveryDate);
      return res.status(400).json({
        success: false,
        message: dateValidation.message
      });
    }

    // ========================================================================
    // VALIDATION: Room delivery fields
    // ========================================================================
    const VALID_HOSTEL_TYPES = ['girls', 'boys'];
    const VALID_HOSTELS = { girls: ['Narmada', 'Krishna', 'Yamuna', 'Godavari', 'Ganga'], boys: ['Ganga-A', 'Vedhavathi', 'Ganga-B', 'New Hostel'] };
    let serverRoomDeliveryCharge = 0;

    if (deliveryType === 'room') {
      if (!hostelType || !VALID_HOSTEL_TYPES.includes(hostelType)) {
        return res.status(400).json({ success: false, message: 'Invalid hostel type for room delivery.' });
      }
      if (!hostelName || !VALID_HOSTELS[hostelType].includes(hostelName)) {
        return res.status(400).json({ success: false, message: 'Invalid hostel name for room delivery.' });
      }
      if (hostelType === 'boys' && (!roomNumber || !roomNumber.trim())) {
        return res.status(400).json({ success: false, message: 'Room number is required for boys hostel delivery.' });
      }

      // Server-side room delivery charge calculation (never trust client)
      const totalQty = cartItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 1), 0);
      if (totalQty <= 2) serverRoomDeliveryCharge = 29;
      else if (totalQty <= 4) serverRoomDeliveryCharge = 49;
      else if (totalQty <= 6) serverRoomDeliveryCharge = 55;
      else if (totalQty <= 8) serverRoomDeliveryCharge = 59;
      else serverRoomDeliveryCharge = 69;
    }

    // ========================================================================
    // VALIDATION: Slot active (vendor settings + NIVA uses partner pool)
    // ========================================================================
    const isLunchSlot = deliverySlot === DELIVERY_SLOTS.SLOT_12_2;
    const isEveningSlot = deliverySlot === DELIVERY_SLOTS.SLOT_630_9;

    if (isLunchSlot && vendorSettings?.lunch_slot_active === false) {
      return res.status(400).json({
        success: false,
        message: 'Lunch slot is unavailable for this restaurant.',
        error_code: 'SLOT_UNAVAILABLE',
      });
    }
    if (isEveningSlot && vendorSettings?.evening_slot_active === false) {
      return res.status(400).json({
        success: false,
        message: 'Evening slot is unavailable for this restaurant.',
        error_code: 'SLOT_UNAVAILABLE',
      });
    }

    if (vendorId === vendorCatalog.DEFAULT_VENDOR_ID) {
      try {
        const { data: activePartners } = await supabase
          .from('partners')
          .select('lunch_slot_active, evening_slot_active')
          .eq('active', true);

        if (activePartners && activePartners.length > 0) {
          if (isLunchSlot && !activePartners.some((p) => p.lunch_slot_active !== false)) {
            return res.status(400).json({
              success: false,
              message: 'The selected time slot is currently unavailable. Please try another slot.',
              error_code: 'SLOT_UNAVAILABLE',
            });
          }
          if (isEveningSlot && !activePartners.some((p) => p.evening_slot_active !== false)) {
            return res.status(400).json({
              success: false,
              message: 'The selected time slot is currently unavailable. Please try another slot.',
              error_code: 'SLOT_UNAVAILABLE',
            });
          }
        }
      } catch (slotError) {
        console.error('Error checking slot availability:', slotError);
      }
    }

    // ========================================================================
    // VALIDATION: Check room delivery availability per slot
    // ========================================================================
    if (deliveryType === 'room') {
      if (isLunchSlot && vendorSettings?.lunch_room_delivery_active === false) {
        return res.status(400).json({
          success: false,
          message: 'Room delivery is unavailable for the lunch slot at this restaurant.',
          error_code: 'ROOM_DELIVERY_UNAVAILABLE',
        });
      }
      if (isEveningSlot && vendorSettings?.evening_room_delivery_active === false) {
        return res.status(400).json({
          success: false,
          message: 'Room delivery is unavailable for the evening slot at this restaurant.',
          error_code: 'ROOM_DELIVERY_UNAVAILABLE',
        });
      }

      try {
        const { data: activePartners } = await supabase
          .from('partners')
          .select('lunch_room_delivery_active, evening_room_delivery_active')
          .eq('active', true);

        if (activePartners && activePartners.length > 0) {
          if (isLunchSlot) {
            const anyHasLunchRoom = activePartners.some(p => p.lunch_room_delivery_active !== false);
            if (!anyHasLunchRoom) {
              return res.status(400).json({
                success: false,
                message: 'Room delivery is currently unavailable for the lunch slot. Please choose normal delivery or try the evening slot.',
                error_code: 'ROOM_DELIVERY_UNAVAILABLE'
              });
            }
          } else {
            const anyHasEveningRoom = activePartners.some(p => p.evening_room_delivery_active !== false);
            if (!anyHasEveningRoom) {
              return res.status(400).json({
                success: false,
                message: 'Room delivery is currently unavailable for the evening slot. Please choose normal delivery or try the lunch slot.',
                error_code: 'ROOM_DELIVERY_UNAVAILABLE'
              });
            }
          }
        }
      } catch (roomSlotErr) {
        console.error('Error checking room delivery availability:', roomSlotErr);
      }
    }

    // ========================================================================
    // VALIDATION: Check stock toggles (fast foods / biryani)
    // ========================================================================
    let stockFastFoodsActive = vendorSettings?.fast_foods_active !== false;
    let stockBiryaniActive = vendorSettings?.biryani_active !== false;
    if (vendorId === vendorCatalog.DEFAULT_VENDOR_ID) {
      try {
        const { data: activePartners } = await supabase
          .from('partners')
          .select('fast_foods_active, biryani_active')
          .eq('active', true);

        if (activePartners && activePartners.length > 0) {
          stockFastFoodsActive = activePartners.some((p) => p.fast_foods_active !== false);
          stockBiryaniActive = activePartners.some((p) => p.biryani_active !== false);
        }
      } catch (stockErr) {
        console.error('Error checking stock toggles:', stockErr);
      }
    }

    // Validate each cart item has required fields
    for (const item of cartItems) {
      if (!item.id || !item.quantity || item.quantity < 1) {
        console.error('SECURITY: Invalid cart item structure:', item);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid cart item. Please refresh your cart.' 
        });
      }
    }

    // ========================================================================
    // FETCH ACTUAL PRICES FROM SERVER CATALOG - Never trust client prices
    // ========================================================================
    let serverCalculatedTotal = 0;
    const verifiedItems = [];

    console.log(`[CREATE-ORDER] Processing ${cartItems.length} cart items for vendor: ${vendorId}`);

    for (const cartItem of cartItems) {
      console.log(`[CREATE-ORDER] Processing cart item:`, JSON.stringify({ id: cartItem.id, name: cartItem.name, type: cartItem.productType || cartItem.type, quantity: cartItem.quantity }));
      
      let productData = null;

      // First, try to find product in server-side catalog by ID and type
      productData = await getProductFromCatalog(
        cartItem.id,
        cartItem.productType || cartItem.type,
        vendorId
      );

      if (!productData && cartItem.name) {
        console.log(`[CREATE-ORDER] Product not found by ID, trying name lookup: ${cartItem.name}`);
        productData = await getProductByName(cartItem.name, vendorId);
      }

      // If product still not found, reject the order
      if (!productData) {
        console.error(`[CREATE-ORDER] SECURITY: Product not found - ID: ${cartItem.id}, Name: ${cartItem.name}, Type: ${cartItem.productType}, VendorId: ${vendorId}`);
        console.error(`[CREATE-ORDER] Cart item full data:`, JSON.stringify(cartItem));
        return res.status(400).json({ 
          success: false, 
          message: `Product "${cartItem.name || cartItem.id}" not found in catalog. Please refresh your cart.` 
        });
      }

      // SECURITY: Check if product is out of stock (static or dynamic toggle)
      const isBiryaniCategory = productData.category === 'Biryani';
      const isFastFood = !isBiryaniCategory; // All non-biryani items are "fast foods"
      const dynamicOutOfStock = (isBiryaniCategory && !stockBiryaniActive) || (isFastFood && !stockFastFoodsActive);

      if (dynamicOutOfStock) {
        console.error(`SECURITY: Out of stock product in cart - ${productData.name} (dynamic toggle off)`);
        return res.status(400).json({
          success: false,
          message: `"${productData.name}" is currently out of stock and cannot be ordered. Please remove it from your cart.`
        });
      }

      // Calculate item total using SERVER price (not client price)
      const serverPrice = parseFloat(productData.price);
      const quantity = parseInt(cartItem.quantity);
      const itemTotal = serverPrice * quantity;

      serverCalculatedTotal += itemTotal;

      // Store verified item with SERVER price for order creation
      verifiedItems.push({
        id: productData.id,
        name: productData.name,
        price: serverPrice,
        quantity: quantity,
        total: itemTotal,
        productType: cartItem.productType || productData.type || 'fastfood',
        image: productData.image || cartItem.image,
        type: cartItem.type || productData.type,
        vendorId,
      });
    }

    // ========================================================================
    // AVAILABILITY GATING: Check restaurant open/closed and item stock
    // Validates: Requirements 10.3, 10.4, 10.5, 6.5
    // ========================================================================
    {
      // Look up menu items from the database by name to determine restaurant_id and in_stock
      const itemNames = verifiedItems.map(item => item.name);
      const { data: dbMenuItems, error: menuLookupError } = await supabase
        .from('menu_items')
        .select('id, name, restaurant_id, in_stock')
        .in('name', itemNames);

      // Only enforce gating if menu_items exist in the new restaurants system
      if (!menuLookupError && dbMenuItems && dbMenuItems.length > 0) {
        // Determine the restaurant_id from items
        const restaurantIds = [...new Set(dbMenuItems.map(mi => mi.restaurant_id).filter(Boolean))];

        if (restaurantIds.length === 1) {
          const restaurantId = restaurantIds[0];

          // Check restaurant availability
          const { data: restaurant, error: restError } = await supabase
            .from('restaurants')
            .select('id, restaurant_available')
            .eq('id', restaurantId)
            .single();

          if (!restError && restaurant && restaurant.restaurant_available === false) {
            return res.status(409).json({
              success: false,
              error: 'Conflict',
              message: 'Restaurant is currently closed'
            });
          }
        }

        // Check in_stock for each line item
        const outOfStockItems = [];
        for (const verifiedItem of verifiedItems) {
          const dbItem = dbMenuItems.find(mi => mi.name === verifiedItem.name);
          if (dbItem && dbItem.in_stock === false) {
            outOfStockItems.push(dbItem.name);
          }
        }

        if (outOfStockItems.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'Conflict',
            message: `Items unavailable: ${outOfStockItems.join(', ')}`
          });
        }
      }
    }

    // ========================================================================
    // APPLY COUPON DISCOUNT (if any) - Server-side validation
    // ========================================================================
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode && couponCode.trim()) {
      // Validate coupon server-side (fixed: use coupon_code column)
      const { data: coupon, error: couponError } = await supabase
        .from('coupons')
        .select('*')
        .eq('coupon_code', couponCode.trim().toUpperCase())
        .eq('is_active', true)
        .single();

      if (!couponError && coupon) {
        // Check coupon validity
        const now = new Date();
        const startDate = coupon.start_date ? new Date(coupon.start_date) : null;
        const endDate = coupon.end_date ? new Date(coupon.end_date) : null;

        const isValidDate = (!startDate || now >= startDate) && (!endDate || now <= endDate);
        const hasUsesLeft = !coupon.max_uses || coupon.times_used < coupon.max_uses;

        if (isValidDate && hasUsesLeft) {
          const couponType = coupon.coupon_type || 'pack';

          if (couponType === 'combo') {
            // COMBO coupon: fixed price for product combo
            const comboProductIds = (coupon.applicable_products || []).map(String);
            const fixedComboPrice = parseFloat(coupon.fixed_combo_price);

            if (comboProductIds.length > 0 && !isNaN(fixedComboPrice)) {
              // Check how many combos can be formed
              const cartQuantitiesMap = {};
              for (const pid of comboProductIds) {
                const matchingItem = verifiedItems.find(item => String(item.id) === pid);
                cartQuantitiesMap[pid] = matchingItem ? matchingItem.quantity : 0;
              }

              const numCombos = Math.min(...comboProductIds.map(pid => cartQuantitiesMap[pid]));

              if (numCombos > 0) {
                const comboOriginalPricePerSet = comboProductIds.reduce((sum, pid) => {
                  const item = verifiedItems.find(i => String(i.id) === pid);
                  return sum + (item ? item.price : 0);
                }, 0);

                const comboOriginalTotal = comboOriginalPricePerSet * numCombos;
                const comboDiscountedTotal = fixedComboPrice * numCombos;
                discountAmount = comboOriginalTotal - comboDiscountedTotal;

                appliedCoupon = {
                  code: coupon.coupon_code,
                  discountType: 'combo',
                  discountValue: fixedComboPrice,
                  discountAmount: discountAmount
                };
              }
            }
          } else {
            // PACK coupon: percentage or flat discount (existing logic)
            let eligibleTotal = serverCalculatedTotal;

            // If coupon is product-specific, only apply to eligible items
            if (coupon.applicable_products && coupon.applicable_products.length > 0) {
              eligibleTotal = verifiedItems
                .filter(item => coupon.applicable_products.includes(String(item.id)))
                .reduce((sum, item) => sum + item.total, 0);
            }

            if (eligibleTotal > 0) {
              if (coupon.discount_type === 'percentage') {
                discountAmount = Math.round((eligibleTotal * coupon.discount_value) / 100);
              } else {
                discountAmount = Math.min(coupon.discount_value, eligibleTotal);
              }

              appliedCoupon = {
                code: coupon.coupon_code,
                discountType: coupon.discount_type,
                discountValue: coupon.discount_value,
                discountAmount: discountAmount
              };
            }
          }
        }
      }
    }

    // ========================================================================
    // CALCULATE FINAL AMOUNT - Server-side only (includes room delivery charge)
    // ========================================================================
    const finalAmount = Math.max(serverCalculatedTotal - discountAmount, 0) + serverRoomDeliveryCharge;

    if (finalAmount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid order amount. Please try again.' 
      });
    }

    // ========================================================================
    // RESOLVE RESTAURANT ID from line items (single-restaurant constraint)
    // ========================================================================
    const { restaurantId: resolvedRestaurantId, error: restaurantError } =
      await resolveRestaurantFromItems(verifiedItems);

    if (restaurantError) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: restaurantError
      });
    }

    // ========================================================================
    // CREATE RAZORPAY ORDER with server-calculated amount
    // ========================================================================
    const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const razorpayOptions = {
      amount: Math.round(finalAmount * 100), // Convert to paise
      currency: 'INR',
      receipt: receiptId,
      payment_capture: 1, // Auto capture
      notes: {
        customer_id: customerId || 'guest',
        items_count: verifiedItems.length,
        original_total: serverCalculatedTotal,
        discount: discountAmount,
        coupon_code: appliedCoupon?.code || '',
        delivery_type: deliveryType || 'normal',
        room_delivery_charge: serverRoomDeliveryCharge
      }
    };
    
    const razorpayOrder = await razorpay.orders.create(razorpayOptions);

    // ========================================================================
    // LOOK UP RESTAURANT NAME for vendor attribution in orders
    // ========================================================================
    let resolvedVendorName = null;
    if (resolvedRestaurantId) {
      const { data: restaurantRow } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', resolvedRestaurantId)
        .single();
      resolvedVendorName = restaurantRow?.name || null;
    }

    // ========================================================================
    // STORE PENDING ORDER for verification during payment callback
    // ========================================================================
    const { data: pendingOrder, error: pendingError } = await supabase
      .from('pending_orders')
      .upsert({
        razorpay_order_id: razorpayOrder.id,
        vendor_id: vendorId,
        customer_id: customerId || null,
        items: JSON.stringify(verifiedItems),
        original_amount: serverCalculatedTotal,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        coupon_code: appliedCoupon?.code || null,
        delivery_slot: deliverySlot,
        delivery_date: deliveryDate,
        delivery_mode: deliveryMode || null,
        delivery_type: deliveryType || 'normal',
        hostel_type: deliveryType === 'room' ? hostelType : null,
        hostel_name: deliveryType === 'room' ? hostelName : null,
        room_number: deliveryType === 'room' && hostelType === 'boys' ? roomNumber : null,
        room_delivery_charge: serverRoomDeliveryCharge,
        restaurant_id: resolvedRestaurantId || null,
        vendor_name: resolvedVendorName,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min expiry
      }, {
        onConflict: 'razorpay_order_id'
      })
      .select()
      .single();

    if (pendingError) {
      console.error('[CREATE-ORDER] CRITICAL: pending_orders upsert failed:', pendingError.message);
      return res.status(500).json({
        success: false,
        message: 'Could not prepare your order for payment. Please try again.',
        error_code: 'PENDING_ORDER_FAILED',
      });
    }

    // ========================================================================
    // RETURN ORDER DETAILS - Amount shown is server-calculated
    // ========================================================================
    console.log(` Secure order created: ${razorpayOrder.id} | Amount: Rs. ${finalAmount} (from DB)`);

    res.json({
      success: true,
      key: razorpayKeyId, // CRITICAL: frontend must use THIS key to open checkout
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount, // In paise
        amountInRupees: finalAmount,  // For display
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt
      },
      pricing: {
        originalTotal: serverCalculatedTotal,
        discount: discountAmount,
        finalAmount: finalAmount,
        couponApplied: appliedCoupon?.code || null
      },
      verifiedItems: verifiedItems // Send back verified items for display
    });
    
  } catch (error) {
    console.error('Error creating secure payment order:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create payment order. Please try again.', 
      error: error.message
    });
  }
});

/**
 * Payment verify (backup) — webhook is source of truth (lib/paymentVerifyHandler.js)
 */
app.post('/api/payment/verify', (req, res) =>
  handlePaymentVerify(req, res, { razorpay, razorpayKeySecret })
);
app.post('/api/orders/verify-payment', (req, res) =>
  handlePaymentVerify(req, res, { razorpay, razorpayKeySecret })
);

app.get('/api/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await razorpay.payments.fetch(paymentId);
    res.json({ success: true, payment });
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch payment details', error: error.message });
  }
});

/**
 * ============================================================================
 * PAYMENT RECOVERY ENDPOINT
 * ============================================================================
 * Called by the frontend when it detects a pending payment that wasn't verified
 * (e.g., browser crash, network failure during verify call).
 * Checks Razorpay API for actual payment status and creates the order if captured.
 * ============================================================================
 */
app.post('/api/payment/recover', (req, res) =>
  handlePaymentRecover(req, res, { razorpay })
);

/**
 * Razorpay webhook — source of truth (lib/paymentWebhookHandler.js)
 * On Vercel, vercel.json routes this path to api/payment/webhook.js instead.
 */
app.post('/api/payment/webhook', (req, res) => handleRazorpayWebhook(req, res, { razorpay }));
app.post('/api/webhook/razorpay', (req, res) => handleRazorpayWebhook(req, res, { razorpay }));

// Create Order (backward-compatible fallback â€” primary flow now uses /api/payment/verify)
// SECURITY: Protected - Only authenticated users can create orders
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { 
      customer_id, 
      customer_name, 
      customer_email, 
      customer_phone, 
      customer_college, 
      items, 
      total_amount, 
      status, 
      order_date,
      payment_id,
      payment_method,
      delivery_slot,
      delivery_date
    } = req.body;
    
    console.log('Order creation request received:', {
      customer_id,
      customer_name,
      customer_email,
      items_type: typeof items,
      items_length: Array.isArray(items) ? items.length : 'not an array',
      total_amount,
      status,
      payment_id,
      payment_method
    });
    
    if (!customer_id || !items || !total_amount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Duplicate guard: if payment_id exists, check if order was already created
    // (e.g., by the /api/payment/verify endpoint)
    if (payment_id) {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('payment_id', payment_id)
        .single();

      if (existingOrder) {
        console.log(`â„¹ï¸ Order already exists for payment_id ${payment_id} â€” returning existing order`);
        return res.json({ success: true, order: existingOrder, duplicate: true });
      }
    }

    // Ensure items is properly formatted (handle both array and string)
    const itemsData = typeof items === 'string' ? items : JSON.stringify(items);

    // ========================================================================
    // RESOLVE RESTAURANT ID from line items (single-restaurant constraint)
    // ========================================================================
    const parsedItemsForResolver = typeof items === 'string' ? JSON.parse(items) : items;
    const { restaurantId: resolvedRestaurantId, error: restaurantError } =
      await resolveRestaurantFromItems(parsedItemsForResolver);

    if (restaurantError) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: restaurantError
      });
    }

    // Determine status and delivery_type for hostel delivery orders
    const deliveryType = req.body.delivery_type || req.body.deliveryType || 'normal';
    const { status: resolvedStatus, deliveryType: resolvedDeliveryType } =
      resolveOrderStatusAndDeliveryType(deliveryType, status || 'placed');

    // Insert order into database
    const { data, error } = await supabase
      .from('orders')
      .insert([{
        customer_id,
        customer_name,
        customer_email,
        customer_phone,
        customer_college,
        items: itemsData,
        total_amount,
        status: resolvedStatus,
        order_date: order_date || new Date().toISOString(),
        placed_at: new Date().toISOString(),
        payment_id: payment_id || null,
        payment_method: payment_method || null,
        delivery_slot: delivery_slot || null,
        delivery_date: delivery_date || null,
        delivery_type: resolvedDeliveryType,
        restaurant_id: resolvedRestaurantId || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating order:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return res.status(500).json({ success: false, message: 'Failed to create order', error: error.message });
    }
    
    console.log('Order created successfully in database:', { 
      orderId: data?.id, 
      status: data?.status,
    });

    // Send emails to customer, admin, and partner using new template system (non-blocking)
    const orderData = {
      orderId: data.id.slice(0, 8).toUpperCase(),
      customer_name,
      customer_email,
      customer_phone,
      customer_college,
      total_amount,
      items: Array.isArray(items) ? items : JSON.parse(items),
      partner_phone: 'Contact Soon'
    };
    
    // Send emails in background without waiting
    sendEmailsToAll('orderPlaced', orderData).catch(emailError => {
      console.error('Email sending failed:', emailError.message);
    });

    res.json({ success: true, order: data });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, message: 'Failed to create order', error: error.message });
  }
});

// Get All Orders (for admin/partner)
// SECURITY: CRITICAL - Protected - Only authenticated Admins/Partners can view all orders
app.get('/api/orders', authenticateToken, requireRole('admin', 'partner'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('order_date', { ascending: false });

    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
});

// Get Orders by Customer ID
// SECURITY: CRITICAL - Protected - Users can only view their own orders
app.get('/api/orders/customer/:customerId', authenticateToken, requireOwnOrder, async (req, res) => {
  try {
    const { customerId } = req.params;

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', customerId)
      .order('order_date', { ascending: false });

    if (error) {
      console.error('Error fetching customer orders:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
    }

    // Parse JSON fields and add a normalized display label
    const STATUS_DISPLAY = {
      placed: 'Pending',
      pending: 'Pending',
      accepted: 'Accepted',
      preparing: 'Being Prepared',
      ready_for_pickup: 'Ready for Pickup',
      taken: 'Accepted',
      picked_up: 'Out for Delivery',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };

    const parsedOrders = (data || []).map(order => {
      const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      return {
        ...order,
        items,
        status_display: STATUS_DISPLAY[order.status] || order.status
      };
    });

    res.json({ success: true, data: parsedOrders });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
});

// Delete Order by ID
// SECURITY: Protected - Admins can delete any order, customers can delete their own orders
app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.user_metadata?.role || req.user.app_metadata?.role;

    // SECURITY LOG: Track deletion attempts (no sensitive data)
    console.log('Order deletion attempt:', {
      orderId: id,
      userId: userId,
      userRole: userRole || 'no-role-set',
      timestamp: new Date().toISOString()
    });

    // First, fetch the order to check ownership
    const { data: orderData, error: fetchError } = await supabase
      .from('orders')
      .select('customer_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !orderData) {
      console.log('Order deletion failed: Order not found', { orderId: id });
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // SECURITY LOG: Compare IDs for debugging
    console.log('Ownership check:', {
      orderCustomerId: orderData.customer_id,
      authenticatedUserId: userId,
      idsMatch: orderData.customer_id === userId,
      typeOrderCustomerId: typeof orderData.customer_id,
      typeUserId: typeof userId
    });

    // Authorization Logic:
    // 1. Admin can delete any order
    // 2. Customer can delete ONLY their own order (strict ownership check)
    // 3. Partner cannot delete customer orders
    // 4. Users without role can delete their own orders (treated as customers)
    
    const isAdmin = userRole === 'admin';
    const isPartner = userRole === 'partner';
    const ownsOrder = String(orderData.customer_id).toLowerCase() === String(userId).toLowerCase();

    // Partners are explicitly denied
    if (isPartner) {
      console.log('Order deletion denied: Partner attempted to delete customer order', {
        orderId: id,
        partnerId: userId
      });
      return res.status(403).json({ 
        success: false, 
        message: 'Partners cannot delete customer orders' 
      });
    }

    // If not admin, must own the order
    if (!isAdmin && !ownsOrder) {
      console.log('Order deletion denied: Ownership check failed', {
        orderId: id,
        orderOwner: orderData.customer_id,
        attemptedBy: userId
      });
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: You can only delete your own orders' 
      });
    }

    // Delete the order
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error deleting order:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete order', error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log('Order deleted successfully:', {
      orderId: id,
      deletedBy: userId,
      deletedByRole: userRole || 'customer'
    });

    res.json({ success: true, message: 'Order deleted successfully', data: data[0] });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ success: false, message: 'Failed to delete order', error: error.message });
  }
});

// =======================
// COUPON ENDPOINTS
// =======================

// Get all products by category (for coupon management)
// Now database-driven to support admin-added products
app.get('/api/products/by-category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    // Query database for products matching the category
    const { data: products, error } = await supabase
      .from('menu_items')
      .select('id, name, price, category, is_active, in_stock')
      .eq('category', category)
      .eq('is_active', true)
      .order('name');
    
    if (error) {
      console.error('Database error fetching products by category:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch products from database' 
      });
    }
    
    const formattedProducts = products.map(p => ({
      id: String(p.id),
      name: p.name,
      price: parseFloat(p.price),
      category: p.category,
      in_stock: p.in_stock
    }));
    
    return res.json({ success: true, products: formattedProducts });
  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// Get all coupons (Admin)
// SECURITY: Protected - Only authenticated Admins can view coupons
app.get('/api/admin/coupons', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, coupons: data });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
});

// Create coupon (Admin) - Supports PACK and COMBO coupon types
// SECURITY: Protected - Only authenticated Admins can create coupons
app.post('/api/admin/coupons', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { couponCode, discountType, discountValue, couponType, applicableProducts, applicableProductNames, fixedComboPrice, endDate } = req.body;
    
    const type = couponType || 'fastfood';

    // Validate required fields
    if (!couponCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Coupon code is required' 
      });
    }

    // Validate discount fields
    if (!discountType || !discountValue) {
      return res.status(400).json({ 
        success: false, 
        message: 'Required fields: discountType, discountValue' 
      });
    }
    if (!['percentage', 'flat'].includes(discountType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'discountType must be either "percentage" or "flat"' 
      });
    }
    const discountVal = parseFloat(discountValue);
    if (isNaN(discountVal) || discountVal <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Discount value must be a positive number' 
      });
    }
    if (discountType === 'percentage' && discountVal > 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Percentage discount cannot exceed 100%' 
      });
    }
    
    // Check if coupon code already exists
    const { data: existing } = await supabase
      .from('coupons')
      .select('coupon_code')
      .eq('coupon_code', couponCode.toUpperCase())
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Coupon code already exists' 
      });
    }
    
    // Build insert data
    const insertData = {
      coupon_code: couponCode.toUpperCase(),
      coupon_type: type,
      product_name: 'All Fast Food Items',
      product_type: 'fastfood',
      discount_type: discountType,
      discount_value: discountVal,
      is_active: true
    };

    if (endDate) {
      insertData.end_date = endDate;
    }

    console.log('Creating coupon with data:', JSON.stringify(insertData, null, 2));

    const { data, error } = await supabase
      .from('coupons')
      .insert([insertData])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }
    
    res.json({ success: true, coupon: data, message: 'Coupon created successfully' });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create coupon' });
  }
});

// Update coupon status (Admin)
// SECURITY: Protected - Only authenticated Admins can update coupons
app.put('/api/admin/coupons/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, discountType, discountValue } = req.body;
    
    const updateData = { updated_at: new Date().toISOString() };
    
    if (typeof isActive === 'boolean') {
      updateData.is_active = isActive;
    }
    
    if (discountType) {
      updateData.discount_type = discountType;
    }
    
    if (discountValue) {
      updateData.discount_value = parseFloat(discountValue);
    }
    
    const { data, error } = await supabase
      .from('coupons')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, coupon: data, message: 'Coupon updated successfully' });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({ success: false, message: 'Failed to update coupon' });
  }
});

// Delete coupon (Admin)
// SECURITY: Protected - Only authenticated Admins can delete coupons
app.delete('/api/admin/coupons/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('coupons')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
});

// Validate coupon (Customer - used during checkout)
// Validate and apply fastfood coupon
app.post('/api/coupon/validate', async (req, res) => {
  try {
    const { couponCode, cartItems } = req.body;
    
    // Validate input
    if (!couponCode || typeof couponCode !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Coupon code is required' 
      });
    }
    
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cart items are required' 
      });
    }
    
    console.log('Validating coupon:', couponCode.toUpperCase());
    console.log('Cart items:', JSON.stringify(cartItems, null, 2));
    
    // Fetch the coupon
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('coupon_code', couponCode.toUpperCase())
      .maybeSingle();
    
    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    // Check if coupon exists
    if (!coupon) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid coupon code' 
      });
    }
    
    console.log('Found coupon:', JSON.stringify(coupon, null, 2));
    
    // Check if coupon is active
    if (!coupon.is_active) {
      return res.status(400).json({ 
        success: false, 
        message: 'This coupon is no longer active' 
      });
    }

    // Check expiry date if set
    if (coupon.end_date) {
      const now = new Date();
      const endDate = new Date(coupon.end_date);
      if (now > endDate) {
        return res.status(400).json({ 
          success: false, 
          message: 'This coupon has expired' 
        });
      }
    }

    // ============================
    // COUPON VALIDATION - DATABASE-DRIVEN PRICING
    // ============================
    // Calculate cart total using DATABASE prices (never trust frontend prices)
    const cartPrices = await Promise.all(
      cartItems.map(async (item) => {
        try {
          // Query database for current product price and availability
          const { data: product, error } = await supabase
            .from('menu_items')
            .select('id, name, price, is_active, in_stock')
            .eq('id', item.id)
            .eq('is_active', true)
            .eq('in_stock', true)
            .maybeSingle();
          
          if (error || !product) {
            console.warn(`Product ${item.id} not found or unavailable in database`);
            return { price: parseFloat(item.price) || 0, productId: item.id, found: false };
          }
          
          const dbPrice = parseFloat(product.price);
          const frontendPrice = parseFloat(item.price) || 0;
          
          // Log price mismatch for debugging
          if (Math.abs(dbPrice - frontendPrice) > 0.01) {
            console.warn(`Price mismatch for product ${item.id}: frontend=${frontendPrice}, database=${dbPrice}`);
          }
          
          return { price: dbPrice, productId: item.id, found: true, dbPrice };
        } catch (dbError) {
          console.error(`Error fetching price for product ${item.id}:`, dbError);
          return { price: parseFloat(item.price) || 0, productId: item.id, found: false };
        }
      })
    );
    
    const cartTotal = cartItems.reduce((sum, item, index) => {
      const quantity = parseInt(item.quantity) || 1;
      const price = cartPrices[index]?.price || parseFloat(item.price) || 0;
      return sum + (price * quantity);
    }, 0);
    
    let discountAmount = 0;
    
    if (coupon.discount_type === 'percentage') {
      discountAmount = Math.round((cartTotal * coupon.discount_value) / 100);
    } else {
      // Flat discount
      discountAmount = Math.min(coupon.discount_value, cartTotal);
    }
    
    // Ensure discount doesn't exceed cart total
    discountAmount = Math.min(discountAmount, cartTotal);
    const finalTotal = cartTotal - discountAmount;
    
    console.log('Coupon validation result:', {
      cartTotal,
      discountAmount,
      finalTotal,
      itemsVerified: cartPrices.filter(p => p.found).length
    });
    
    res.json({
      success: true,
      message: `Coupon applied! You save ₹${discountAmount}!`,
      coupon: {
        code: coupon.coupon_code,
        category: 'fastfood',
        couponType: 'fastfood',
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value
      },
      eligibleItems: cartItems.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      })),
      pricing: {
        eligibleTotal: cartTotal,
        discountAmount,
        originalTotal: cartTotal,
        finalTotal
      }
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ success: false, message: 'Failed to validate coupon. Please try again.' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Root route - helps verify backend is accessible
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'NIVA Backend API is running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      customers: '/api/customers/:id',
      orders: '/api/customer/order'
    }
  });
});

// ─── Partner Orders Router ─────────────────────────────────────────────────
app.use('/api/partner/orders', partnerOrdersRouter);

// ─── Restaurant Portal Router ──────────────────────────────────────────────
app.use('/api/restaurant-portal', restaurantPortalRouter);

// ─── Admin Restaurants Router ──────────────────────────────────────────────
app.use('/api/admin/restaurants', adminRestaurantsRouter);

// Handle 404 - Return JSON instead of HTML for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'API endpoint not found',
    path: req.originalUrl 
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// â”€â”€â”€ Vercel serverless export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Required for @vercel/node builder to route requests to Express
module.exports = app;
// Category Constants & Validation (for use in other modules)
// These can be imported by other backend modules for category validation
module.exports.VALID_CATEGORIES = VALID_CATEGORIES;
module.exports.validateCategory = validateCategory;
