/**
 * Authentication & Authorization Middleware
 *
 * Provides:
 * - authenticateToken: Verifies Supabase JWT and attaches user + role to req
 * - requireRole: Returns middleware that restricts access to specified roles
 * - extractRestaurantId: Resolves restaurant_owner's restaurant and attaches req.restaurantId
 *
 * Recognized roles: admin, partner, customer, restaurant_owner
 */

const { getSupabase } = require('../lib/supabase');

/**
 * CRITICAL: Authentication Middleware
 * Verifies Supabase JWT tokens from Authorization header.
 * DENY-BY-DEFAULT: All requests without valid tokens are rejected.
 *
 * Sets:
 *   req.user     — the verified Supabase user object
 *   req.userRole — role extracted from user_metadata.role or app_metadata.role
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    const supabase = getSupabase();
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

    // Extract role from metadata (user_metadata takes precedence, fallback to app_metadata)
    req.userRole = user.user_metadata?.role || user.app_metadata?.role || null;

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
 * Verifies the authenticated user's role is in the allowed set.
 * MUST be used after authenticateToken.
 *
 * Supported roles: 'admin', 'partner', 'customer', 'restaurant_owner'
 *
 * @param {...string} allowedRoles - One or more roles that are permitted
 * @returns {Function} Express middleware
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userRole = req.userRole;

      if (!userRole) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'User role not configured'
        });
      }

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}`
        });
      }

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
 * Middleware: extractRestaurantId
 *
 * For restaurant_owner role, looks up `restaurants.id` by matching `owner_phone`
 * to the authenticated user's phone number and attaches it to req.restaurantId.
 *
 * Phone resolution order:
 *   1. user_metadata.phone
 *   2. Extracted from synthetic email pattern: <phone>@restaurant.niva.in
 *
 * For non-restaurant_owner roles, this middleware is a passthrough.
 */
const extractRestaurantId = async (req, res, next) => {
  try {
    // Only applies to restaurant_owner role
    if (req.userRole !== 'restaurant_owner') {
      return next();
    }

    // Resolve owner phone from user metadata or synthetic email
    let phone = req.user.user_metadata?.phone;

    if (!phone && req.user.email) {
      // Synthetic email pattern: <phone>@restaurant.niva.in
      const emailMatch = req.user.email.match(/^(\d+)@restaurant\.niva\.in$/);
      if (emailMatch) {
        phone = emailMatch[1];
      }
    }

    if (!phone) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Unable to determine restaurant owner identity'
      });
    }

    // Look up the restaurant by owner_phone
    const supabase = getSupabase();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id')
      .eq('owner_phone', phone)
      .single();

    if (error || !restaurant) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'No restaurant linked to this account'
      });
    }

    req.restaurantId = restaurant.id;
    next();
  } catch (error) {
    console.error('extractRestaurantId error:', error);
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Failed to resolve restaurant identity'
    });
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  extractRestaurantId
};
