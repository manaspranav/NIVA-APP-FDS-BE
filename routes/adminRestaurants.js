/**
 * Admin Restaurant Management Router
 *
 * Mounted at /api/admin/restaurants
 * Provides endpoints for admins to create restaurants, update settings,
 * and reset owner passwords.
 *
 * All endpoints require `admin` role (enforced at router level).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getSupabase } = require('../lib/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes in this router require admin authentication
router.use(authenticateToken, requireRole('admin'));

// ─── POST / — Create a new restaurant ────────────────────────────────────────

/**
 * POST /
 * Requires admin role (enforced by router-level middleware).
 * Accepts: name, cuisine, location, owner_phone, owner_password, is_active, restaurant_available
 * Hashes password with bcrypt (cost ≥ 10) before storing.
 * Validates owner_phone uniqueness; returns HTTP 409 if already assigned.
 * Never persists plaintext password.
 *
 * Validates: Requirements 2.2, 2.5, 2.7, 12.1, 12.2
 */
router.post('/', async (req, res) => {
  try {
    const { name, cuisine, location, owner_phone, owner_password, is_active, restaurant_available } = req.body;

    // Basic validation
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Restaurant name is required'
      });
    }

    const supabase = getSupabase();

    // Validate owner_phone uniqueness if provided
    if (owner_phone) {
      const { data: existing, error: phoneCheckError } = await supabase
        .from('restaurants')
        .select('id')
        .eq('owner_phone', owner_phone);

      if (phoneCheckError) {
        console.error('[AdminRestaurants] POST / phone check error:', phoneCheckError.message);
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to validate phone number'
        });
      }

      if (existing && existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'Phone number already assigned to another restaurant'
        });
      }
    }

    // Hash password with bcrypt if provided (cost factor ≥ 10)
    let owner_password_hash = null;
    if (owner_password) {
      owner_password_hash = await bcrypt.hash(owner_password, 10);
    }

    // Build insert object
    const insertObj = {
      name,
      cuisine: cuisine || null,
      location: location || null,
      owner_phone: owner_phone || null,
      owner_password_hash,
      is_active: is_active !== undefined ? is_active : true,
      restaurant_available: restaurant_available !== undefined ? restaurant_available : true
    };

    const { data: restaurant, error: insertError } = await supabase
      .from('restaurants')
      .insert([insertObj])
      .select('id, name, cuisine, location, owner_phone, is_active, restaurant_available')
      .single();

    if (insertError) {
      console.error('[AdminRestaurants] POST / insert error:', insertError.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to create restaurant'
      });
    }

    return res.status(201).json({
      success: true,
      restaurant
    });
  } catch (err) {
    console.error('[AdminRestaurants] POST / unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to create restaurant'
    });
  }
});

// ─── PUT /:id — Update restaurant fields ─────────────────────────────────────

/**
 * PUT /:id
 * Requires admin role (enforced by router-level middleware).
 * Accepts: owner_phone, restaurant_available, is_active
 * Validates owner_phone uniqueness if changed; returns HTTP 409 if already assigned.
 * Updates only the provided (defined) fields.
 *
 * Validates: Requirements 2.3, 2.7, 2.8, 2.9
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { owner_phone, restaurant_available, is_active } = req.body;

    const supabase = getSupabase();

    // If owner_phone is provided, check uniqueness against other restaurants
    if (owner_phone !== undefined && owner_phone !== null) {
      const { data: existing, error: phoneCheckError } = await supabase
        .from('restaurants')
        .select('id')
        .eq('owner_phone', owner_phone)
        .neq('id', id);

      if (phoneCheckError) {
        console.error('[AdminRestaurants] PUT /:id phone check error:', phoneCheckError.message);
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to validate phone number'
        });
      }

      if (existing && existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'Phone number already assigned to another restaurant'
        });
      }
    }

    // Build update object with only defined fields
    const updateObj = {};
    if (owner_phone !== undefined) {
      updateObj.owner_phone = owner_phone;
    }
    if (restaurant_available !== undefined) {
      updateObj.restaurant_available = restaurant_available;
    }
    if (is_active !== undefined) {
      updateObj.is_active = is_active;
    }

    // If no fields to update, return 400
    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'No valid fields provided for update'
      });
    }

    // Update the restaurant row
    const { data: restaurant, error: updateError } = await supabase
      .from('restaurants')
      .update(updateObj)
      .eq('id', id)
      .select('id, name, cuisine, location, owner_phone, is_active, restaurant_available')
      .single();

    if (updateError) {
      // Check if it's a "not found" error
      if (updateError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: 'Restaurant not found'
        });
      }
      console.error('[AdminRestaurants] PUT /:id update error:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to update restaurant'
      });
    }

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Restaurant not found'
      });
    }

    return res.status(200).json({
      success: true,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine: restaurant.cuisine,
        location: restaurant.location,
        owner_phone: restaurant.owner_phone,
        is_active: restaurant.is_active,
        restaurant_available: restaurant.restaurant_available
      }
    });
  } catch (err) {
    console.error('[AdminRestaurants] PUT /:id unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to update restaurant'
    });
  }
});

// ─── POST /:id/reset-password — Reset owner password ─────────────────────────

/**
 * POST /:id/reset-password
 * Requires admin role (enforced by router-level middleware).
 * Accepts: new_password
 * Hashes with bcrypt (cost factor ≥ 10) and updates owner_password_hash.
 * Omits password hash from response body.
 * Also updates the corresponding Supabase Auth user's password for sync.
 *
 * Validates: Requirements 2.4, 2.5, 12.1, 12.2
 */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'new_password is required'
      });
    }

    const supabase = getSupabase();

    // Fetch the restaurant to get owner_phone (needed for Supabase Auth sync)
    const { data: restaurant, error: fetchError } = await supabase
      .from('restaurants')
      .select('id, owner_phone')
      .eq('id', id)
      .single();

    if (fetchError || !restaurant) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Restaurant not found'
      });
    }

    // Hash new password with bcrypt (cost factor ≥ 10)
    const owner_password_hash = await bcrypt.hash(new_password, 10);

    // Update the password hash in the restaurants table
    const { error: updateError } = await supabase
      .from('restaurants')
      .update({ owner_password_hash })
      .eq('id', id);

    if (updateError) {
      console.error('[AdminRestaurants] POST /:id/reset-password update error:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to reset password'
      });
    }

    // Sync with Supabase Auth if owner_phone exists
    if (restaurant.owner_phone) {
      const syntheticEmail = `${restaurant.owner_phone}@restaurant.niva.in`;
      try {
        // Find the Supabase Auth user by email
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (!listError && users) {
          const authUser = users.find(u => u.email === syntheticEmail);
          if (authUser) {
            await supabase.auth.admin.updateUserById(authUser.id, {
              password: new_password
            });
          }
        }
      } catch (syncErr) {
        // Log but don't fail the request — DB is the canonical credential store
        console.error('[AdminRestaurants] Supabase Auth sync warning:', syncErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (err) {
    console.error('[AdminRestaurants] POST /:id/reset-password unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to reset password'
    });
  }
});

module.exports = router;
