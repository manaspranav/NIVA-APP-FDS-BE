/**
 * Restaurant Partner Portal Router
 *
 * Mounted at /api/restaurant-portal
 * Provides endpoints for restaurant owner login, menu management,
 * order management, and restaurant availability toggling.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { sendStatusUpdateEmail } = require('../lib/emailService');
const { getSupabase } = require('../lib/supabase');
const { authenticateToken, requireRole, extractRestaurantId } = require('../middleware/auth');
const { sanitizeMenuItemForRestaurantOwner, sanitizeOrderForRestaurantOwner } = require('../lib/orderSerializer');
const { checkLoginRateLimit, recordFailedAttempt, resetAttempts } = require('../lib/loginRateLimiter');



const router = express.Router();

// ─── Public Endpoints ───────────────────────────────────────────────────────

/**
 * GET /restaurants/active
 * Public endpoint — no auth required.
 * Returns active restaurants for the login dropdown.
 * Fields: id, name, cuisine, location
 */
router.get('/restaurants/active', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, cuisine, location')
      .eq('is_active', true);

    if (error) {
      console.error('[RestaurantPortal] GET /restaurants/active error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to fetch active restaurants'
      });
    }

    return res.status(200).json({
      success: true,
      restaurants: restaurants || []
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /restaurants/active unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch active restaurants'
    });
  }
});

/**
 * POST /login
 * Public endpoint — rate-limited per owner_phone.
 * Authenticates restaurant owner via restaurant selection, phone, and password.
 * On success: signs into Supabase Auth with synthetic email, returns JWT + restaurant info.
 * On failure: returns generic 401 message regardless of which field failed.
 * If restaurant is_active is false: returns 403.
 * If owner_password_hash is null/empty: returns 401.
 * Integrates login rate limiter (max 10 failed attempts per 15-minute window per phone).
 *
 * Validates: Requirements 3.3, 3.4, 3.5, 3.8, 3.9, 12.3, 12.4
 */
router.post('/login', async (req, res) => {
  try {
    const { restaurantId, phone, password } = req.body;

    // Basic validation
    if (!restaurantId || !phone || !password) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Rate limit check
    const rateLimitResult = checkLoginRateLimit(phone);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Too many attempts',
        retryAfter: rateLimitResult.retryAfter
      });
    }

    const supabase = getSupabase();

    // Fetch the restaurant by id
    const { data: restaurant, error: fetchError } = await supabase
      .from('restaurants')
      .select('id, name, cuisine, location, owner_phone, owner_password_hash, is_active')
      .eq('id', restaurantId)
      .single();

    if (fetchError || !restaurant) {
      recordFailedAttempt(phone);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Check if restaurant is active
    if (!restaurant.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Restaurant is deactivated'
      });
    }

    // Verify owner_password_hash is not null/empty
    if (!restaurant.owner_password_hash) {
      recordFailedAttempt(phone);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Verify phone matches owner_phone
    if (restaurant.owner_phone !== phone) {
      recordFailedAttempt(phone);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Bcrypt-compare password against stored hash (constant-time)
    const passwordMatch = await bcrypt.compare(password, restaurant.owner_password_hash);
    if (!passwordMatch) {
      recordFailedAttempt(phone);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Credentials valid — sign into Supabase Auth with synthetic email
    const syntheticEmail = `${phone}@restaurant.niva.in`;
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password: password
    });

    if (authError || !authData?.session) {
      // Auth sign-in failed; still consider credentials valid from our perspective
      // but we can't issue a session token
      console.error('[RestaurantPortal] POST /login Supabase auth error:', authError?.message);
      recordFailedAttempt(phone);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid credentials'
      });
    }

    // Reset rate limiter on success
    resetAttempts(phone);

    return res.status(200).json({
      success: true,
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine: restaurant.cuisine,
        location: restaurant.location
      }
    });
  } catch (err) {
    console.error('[RestaurantPortal] POST /login unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Login failed'
    });
  }
});

// ─── Protected Endpoints ─────────────────────────────────────────────────────

/**
 * POST /logout
 * Requires restaurant_owner role.
 * Invalidates the Supabase session via signOut.
 * Returns success response.
 *
 * Validates: Requirements 3.7, 13.5
 */
router.post('/logout', authenticateToken, requireRole('restaurant_owner'), async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.auth.signOut();

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('[RestaurantPortal] POST /logout error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to logout'
    });
  }
});

/**
 * GET /menu
 * Requires restaurant_owner role.
 * Returns menu items for the authenticated owner's restaurant,
 * with monetary fields (price) stripped via sanitizer.
 *
 * Validates: Requirements 5.1, 5.8
 */
router.get('/menu', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: items, error } = await supabase
      .from('menu_items')
      .select('id, name, category, image_url, is_veg, in_stock, price')
      .eq('restaurant_id', req.restaurantId);

    if (error) {
      console.error('[RestaurantPortal] GET /menu error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to fetch menu items'
      });
    }

    const sanitizedItems = (items || []).map(item => sanitizeMenuItemForRestaurantOwner(item));

    return res.status(200).json({
      success: true,
      items: sanitizedItems
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /menu unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch menu items'
    });
  }
});

/**
 * PUT /restaurant/availability
 * Requires restaurant_owner role.
 * Toggles the restaurant's open/closed status.
 * Accepts { available: boolean } in body.
 * Verifies the target restaurant matches the authenticated owner's restaurant.
 *
 * Validates: Requirements 6.2, 6.3
 */
router.put(
  '/restaurant/availability',
  authenticateToken,
  requireRole('restaurant_owner'),
  extractRestaurantId,
  async (req, res) => {
    try {
      const { available } = req.body;

      // Validate that 'available' is a boolean
      if (typeof available !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: 'Field "available" must be a boolean'
        });
      }

      // req.restaurantId is set by extractRestaurantId middleware,
      // which already ensures the restaurant belongs to the authenticated owner.
      // This inherently enforces the 403 check for restaurant mismatch.
      const supabase = getSupabase();
      const { error } = await supabase
        .from('restaurants')
        .update({ restaurant_available: available })
        .eq('id', req.restaurantId);

      if (error) {
        console.error('[RestaurantPortal] PUT /restaurant/availability error:', error.message);
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update restaurant availability'
        });
      }

      return res.status(200).json({
        success: true,
        restaurant_available: available
      });
    } catch (err) {
      console.error('[RestaurantPortal] PUT /restaurant/availability unexpected error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to update restaurant availability'
      });
    }
  }
);

/**
 * GET /restaurant
 * Requires restaurant_owner role.
 * Returns restaurant details including availability status.
 *
 * Validates: Requirements 6.1
 */
router.get('/restaurant', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id, name, cuisine, location, restaurant_available, is_active')
      .eq('id', req.restaurantId)
      .single();

    if (error || !restaurant) {
      console.error('[RestaurantPortal] GET /restaurant error:', error?.message || 'Not found');
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Restaurant not found'
      });
    }

    return res.status(200).json({
      success: true,
      restaurant
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /restaurant unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch restaurant details'
    });
  }
});

/**
 * PUT /menu/:itemId/stock
 * Requires restaurant_owner role.
 * Toggles the in_stock status of a menu item.
 * Verifies item belongs to the authenticated owner's restaurant.
 *
 * Validates: Requirements 5.4, 5.5
 */
router.put('/menu/:itemId/stock', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { in_stock } = req.body;

    // Validate in_stock is a boolean
    if (typeof in_stock !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'in_stock must be a boolean'
      });
    }

    const supabase = getSupabase();

    // Fetch the menu item by id
    const { data: item, error: fetchError } = await supabase
      .from('menu_items')
      .select('id, name, restaurant_id, in_stock')
      .eq('id', itemId)
      .single();

    if (fetchError || !item) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Menu item not found'
      });
    }

    // Verify item belongs to authenticated owner's restaurant
    if (item.restaurant_id !== req.restaurantId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Access denied. Item does not belong to your restaurant'
      });
    }

    // Update in_stock status
    const { data: updatedItem, error: updateError } = await supabase
      .from('menu_items')
      .update({ in_stock })
      .eq('id', itemId)
      .select('id, name, in_stock')
      .single();

    if (updateError) {
      console.error('[RestaurantPortal] PUT /menu/:itemId/stock update error:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to update stock status'
      });
    }

    return res.status(200).json({
      success: true,
      item: {
        id: updatedItem.id,
        name: updatedItem.name,
        in_stock: updatedItem.in_stock
      }
    });
  } catch (err) {
    console.error('[RestaurantPortal] PUT /menu/:itemId/stock unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to update stock status'
    });
  }
});

/**
 * GET /profile
 * Requires restaurant_owner role.
 * Returns restaurant profile info: name, cuisine, location, owner_phone.
 * NEVER includes owner_password_hash in the response.
 *
 * Validates: Requirements 13.1, 13.2
 */
router.get('/profile', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id, name, cuisine, location, owner_phone')
      .eq('id', req.restaurantId)
      .single();

    if (error || !restaurant) {
      if (error && error.code !== 'PGRST116') {
        console.error('[RestaurantPortal] GET /profile error:', error.message);
      }
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Restaurant profile not found'
      });
    }

    return res.status(200).json({
      success: true,
      profile: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine: restaurant.cuisine,
        location: restaurant.location,
        owner_phone: restaurant.owner_phone
      }
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /profile unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch restaurant profile'
    });
  }
});

/**
 * PUT /orders/:orderId/status
 * Requires restaurant_owner role.
 * Advances an order's status through the restaurant-owner allowed transitions.
 * Uses the SAME workflow as the Partner Panel:
 *   pending → taken, placed → taken, taken → out_for_delivery, out_for_delivery → delivered
 * Also allows cancellation from pending or placed.
 * On success: updates status and sets corresponding timestamp.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */
router.put(
  '/orders/:orderId/status',
  authenticateToken,
  requireRole('restaurant_owner'),
  extractRestaurantId,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status: targetStatus } = req.body;

      const supabase = getSupabase();

      // Fetch the order by id
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('id, status, restaurant_id, customer_name, customer_email, accepted_at, preparing_at, ready_for_pickup_at')
        .eq('id', orderId)
        .single();

      if (fetchError || !order) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: 'Order not found'
        });
      }

      // Verify order belongs to authenticated owner's restaurant
      if (order.restaurant_id !== req.restaurantId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      // Define allowed transitions for restaurant owner — same as partner panel workflow.
      // Both 'pending' (room delivery) and 'placed' (normal delivery) are valid start states.
      const allowedTransitions = {
        pending: ['taken', 'cancelled'],
        placed: ['taken', 'cancelled'],
        taken: ['out_for_delivery'],
        out_for_delivery: ['delivered'],
      };

      const currentStatus = order.status;
      const allowedTargets = allowedTransitions[currentStatus];

      // If current status is not in the map keys, or target is not in allowed list
      if (!allowedTargets || !allowedTargets.includes(targetStatus)) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: `Cannot transition from ${currentStatus} to ${targetStatus}`
        });
      }

      // Build update object
      const updateObj = { status: targetStatus };

      // Set timestamp based on target status
      const now = new Date().toISOString();
      if (targetStatus === 'taken') {
        updateObj.taken_at = now;
      } else if (targetStatus === 'out_for_delivery') {
        updateObj.out_for_delivery_at = now;
      } else if (targetStatus === 'delivered') {
        updateObj.delivered_at = now;
      }

      // Update the order
      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update(updateObj)
        .eq('id', orderId)
        .select('id, status, customer_name, customer_email, taken_at, out_for_delivery_at, delivered_at')
        .single();

      if (updateError) {
        console.error('[RestaurantPortal] PUT /orders/:orderId/status update error:', updateError.message);
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update order status'
        });
      }

      // Send email notifications (non-blocking) via centralized emailService
      // Note: Fire-and-forget; don't await or .catch() to keep response fast
      sendStatusUpdateEmail(
        { id: orderId, customer_name: order.customer_name, customer_email: order.customer_email },
        targetStatus
      ).then(() => {
        console.log('[RestaurantPortal] Status email sent successfully for order:', orderId);
      }).catch(e => {
        console.error('[RestaurantPortal] Status email failed for order', orderId + ':', e.message);
      });

      return res.status(200).json({
        success: true,
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          taken_at: updatedOrder.taken_at,
          out_for_delivery_at: updatedOrder.out_for_delivery_at,
          delivered_at: updatedOrder.delivered_at
        }
      });
    } catch (err) {
      console.error('[RestaurantPortal] PUT /orders/:orderId/status unexpected error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to update order status'
      });
    }
  }
);

/**
 * GET /orders
 * Requires restaurant_owner role.
 * Returns orders for the authenticated owner's restaurant,
 * sorted by created_at descending, with all monetary fields stripped.
 * For normal delivery: restaurant-only orders.
 * For room delivery: visible to both restaurant and partner panels.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5
 */
router.get('/orders', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, customer_name, customer_phone, customer_college, room_number, hostel_name, hostel_type, items, status, delivery_type, delivery_slot, delivery_date, created_at, taken_at, out_for_delivery_at, delivered_at')
      .eq('restaurant_id', req.restaurantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[RestaurantPortal] GET /orders error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to fetch orders'
      });
    }

    const sanitizedOrders = (orders || []).map(order => sanitizeOrderForRestaurantOwner(order));

    return res.status(200).json({
      success: true,
      orders: sanitizedOrders
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /orders unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch orders'
    });
  }
});

/**
 * GET /orders/:orderId
 * Requires restaurant_owner role.
 * Returns a single order's detail with monetary fields stripped.
 * Verifies the order belongs to the authenticated owner's restaurant.
 *
 * Validates: Requirements 7.2, 7.4, 7.6
 */
router.get('/orders/:orderId', authenticateToken, requireRole('restaurant_owner'), extractRestaurantId, async (req, res) => {
  try {
    const { orderId } = req.params;

    const supabase = getSupabase();
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Order not found'
      });
    }

    // Verify order belongs to the authenticated owner's restaurant
    if (order.restaurant_id !== req.restaurantId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Access denied. Order does not belong to your restaurant'
      });
    }

    // Strip all monetary fields before returning
    const sanitizedOrder = sanitizeOrderForRestaurantOwner(order);

    return res.status(200).json({
      success: true,
      order: sanitizedOrder
    });
  } catch (err) {
    console.error('[RestaurantPortal] GET /orders/:orderId unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch order details'
    });
  }
});

module.exports = router;
