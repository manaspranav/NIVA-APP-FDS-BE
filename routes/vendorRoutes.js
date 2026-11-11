/**
 * Multi-vendor APIs — menus stay hardcoded; DB stores vendor + settings + order routing.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  DEFAULT_VENDOR_ID,
  getProductFromCatalog,
} = require('../lib/vendorCatalog');

const LUNCH_SLOT = '12:00 PM - 2:00 PM';
const EVENING_SLOT = '6:30 PM - 9:00 PM';

function createVendorRouter({ supabase, razorpay, razorpayKeyId }) {
  const router = express.Router();

  async function getVendorSettings(vendorId) {
    const { data, error } = await supabase
      .from('vendor_settings')
      .select('*')
      .eq('vendor_id', vendorId)
      .maybeSingle();
    if (error) console.error('[VENDOR] settings error:', error.message);
    return data;
  }

  async function getVendorRow(vendorIdOrSlug) {
    let q = supabase.from('vendors').select('*').eq('id', vendorIdOrSlug);
    let { data } = await q.maybeSingle();
    if (data) return data;
    const res2 = await supabase.from('vendors').select('*').eq('slug', vendorIdOrSlug).maybeSingle();
    return res2.data;
  }

  /** Vendor login — phone + password from vendors table */
  router.post('/login', async (req, res) => {
    try {
      const { phone, password } = req.body;
      if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'Phone and password required' });
      }

      const { data: vendor, error } = await supabase
        .from('vendors')
        .select('id, slug, name, login_phone, login_password, is_active')
        .eq('login_phone', phone)
        .maybeSingle();

      if (error || !vendor) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      let valid = false;
      if (vendor.login_password?.startsWith('$2')) {
        valid = await bcrypt.compare(password, vendor.login_password);
      } else {
        valid = vendor.login_password === password;
      }

      if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      if (!vendor.is_active) {
        return res.status(403).json({ success: false, message: 'Restaurant is deactivated' });
      }

      const token = Buffer.from(`${vendor.id}:${Date.now()}`).toString('base64');

      return res.json({
        success: true,
        vendor: { id: vendor.id, slug: vendor.slug, name: vendor.name },
        token,
      });
    } catch (e) {
      console.error('[VENDOR] login:', e.message);
      return res.status(500).json({ success: false, message: 'Login failed' });
    }
  });

  async function vendorAuth(req, res, next) {
    const slug = req.params.slug;
    const vendorIdHeader = req.headers['x-vendor-id'];
    const token = req.headers['x-vendor-token'];
    if (!slug || !token) {
      return res.status(401).json({ success: false, message: 'Vendor authentication required' });
    }
    const vendor = await getVendorRow(slug);
    if (!vendor || vendor.slug !== slug) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    if (vendorIdHeader && vendorIdHeader !== vendor.id) {
      return res.status(403).json({ success: false, message: 'Vendor mismatch' });
    }
    req.vendor = vendor;
    next();
  }

  router.get('/list', async (req, res) => {
    try {
      const { data: vendors, error } = await supabase
        .from('vendors')
        .select('id, slug, name, tagline, description, banner_image, logo_image, supports_room_delivery, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const withSettings = await Promise.all(
        (vendors || []).map(async (v) => {
          const settings = await getVendorSettings(v.id);
          return {
            ...v,
            isOpen: settings?.is_open !== false,
            acceptingOrders: settings?.accepting_orders !== false,
          };
        })
      );

      res.json({ success: true, vendors: withSettings });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.get('/:slug', async (req, res) => {
    const vendor = await getVendorRow(req.params.slug);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    const settings = await getVendorSettings(vendor.id);
    res.json({
      success: true,
      vendor: {
        ...vendor,
        settings: settings || {},
        isOpen: settings?.is_open !== false,
        acceptingOrders: settings?.accepting_orders !== false,
      },
    });
  });

  router.get('/:slug/slot-availability', async (req, res) => {
    try {
      const vendor = await getVendorRow(req.params.slug);
      if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

      const settings = await getVendorSettings(vendor.id);
      const open = settings?.is_open !== false && settings?.accepting_orders !== false;

      if (vendor.id === DEFAULT_VENDOR_ID) {
        const { data: partners } = await supabase
          .from('partners')
          .select('lunch_slot_active, evening_slot_active, lunch_room_delivery_active, evening_room_delivery_active, fast_foods_active, biryani_active')
          .eq('active', true);

        const active = partners || [];
        const lunchSlotActive =
          open && active.some((p) => p.lunch_slot_active !== false) && settings?.lunch_slot_active !== false;
        const eveningSlotActive =
          open && active.some((p) => p.evening_slot_active !== false) && settings?.evening_slot_active !== false;
        const lunchRoomDeliveryActive =
          open && active.some((p) => p.lunch_room_delivery_active !== false) && settings?.lunch_room_delivery_active !== false;
        const eveningRoomDeliveryActive =
          open && active.some((p) => p.evening_room_delivery_active !== false) && settings?.evening_room_delivery_active !== false;

        return res.json({
          success: true,
          vendorId: vendor.id,
          isOpen: open,
          slots: {
            lunchSlotActive,
            eveningSlotActive,
            lunchRoomDeliveryActive,
            eveningRoomDeliveryActive,
          },
          stock: {
            fastFoodsActive: open && active.some((p) => p.fast_foods_active !== false),
            biryaniActive: open && active.some((p) => p.biryani_active !== false),
          },
        });
      }

      return res.json({
        success: true,
        vendorId: vendor.id,
        isOpen: open,
        slots: {
          lunchSlotActive: open && settings?.lunch_slot_active !== false,
          eveningSlotActive: open && settings?.evening_slot_active !== false,
          lunchRoomDeliveryActive: open && settings?.lunch_room_delivery_active !== false,
          eveningRoomDeliveryActive: open && settings?.evening_room_delivery_active !== false,
        },
        stock: {
          fastFoodsActive: open && settings?.fast_foods_active !== false,
          biryaniActive: open && settings?.biryani_active !== false,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.get('/:slug/orders', vendorAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('vendor_id', req.vendor.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const orders = (data || []).map((o) => ({
        ...o,
        items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
      }));

      res.json({ success: true, orders });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.put('/:slug/settings', vendorAuth, async (req, res) => {
    try {
      const {
        isOpen,
        acceptingOrders,
        lunchSlotActive,
        eveningSlotActive,
        lunchRoomDeliveryActive,
        eveningRoomDeliveryActive,
        fastFoodsActive,
        biryaniActive,
      } = req.body;

      const patch = { updated_at: new Date().toISOString() };
      if (typeof isOpen === 'boolean') patch.is_open = isOpen;
      if (typeof acceptingOrders === 'boolean') patch.accepting_orders = acceptingOrders;
      if (typeof lunchSlotActive === 'boolean') patch.lunch_slot_active = lunchSlotActive;
      if (typeof eveningSlotActive === 'boolean') patch.evening_slot_active = eveningSlotActive;
      if (typeof lunchRoomDeliveryActive === 'boolean') patch.lunch_room_delivery_active = lunchRoomDeliveryActive;
      if (typeof eveningRoomDeliveryActive === 'boolean') patch.evening_room_delivery_active = eveningRoomDeliveryActive;
      if (typeof fastFoodsActive === 'boolean') patch.fast_foods_active = fastFoodsActive;
      if (typeof biryaniActive === 'boolean') patch.biryani_active = biryaniActive;

      const { data, error } = await supabase
        .from('vendor_settings')
        .update(patch)
        .eq('vendor_id', req.vendor.id)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, settings: data });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  const VENDOR_STATUS_FLOW = {
    placed: ['preparing', 'rejected', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['completed'],
    taken: ['preparing', 'ready'],
  };

  router.put('/:slug/orders/:orderId/status', vendorAuth, async (req, res) => {
    try {
      const { status } = req.body;
      const allowed = ['preparing', 'ready', 'completed', 'rejected', 'cancelled', 'placed'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }

      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select('id, status, vendor_id')
        .eq('id', req.params.orderId)
        .eq('vendor_id', req.vendor.id)
        .maybeSingle();

      if (fetchErr || !order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const patch = { status, updated_at: new Date().toISOString() };
      if (status === 'preparing') patch.taken_at = new Date().toISOString();
      if (status === 'ready') patch.out_for_delivery_at = new Date().toISOString();
      if (status === 'completed') patch.delivered_at = new Date().toISOString();

      const { data: updated, error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', order.id)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, order: updated });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ========================================
  // MENU ITEM MANAGEMENT ENDPOINTS
  // ========================================

  /**
   * POST /:vendorId/menu-items
   * Create a new menu item for a vendor
   * Validates: category must be in VALID_CATEGORIES
   * Returns 400 if category is invalid with message listing valid categories
   */
  router.post('/:vendorId/menu-items', async (req, res) => {
    try {
      const { vendorId } = req.params;
      const { name, description, category, price, is_veg, image_url } = req.body;

      // Validate required fields
      if (!name || !category) {
        return res.status(400).json({
          success: false,
          message: 'Name and category are required'
        });
      }

      // Validate category
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

      const validateCategory = (cat) => {
        if (!cat || typeof cat !== 'string') {
          return false;
        }
        return VALID_CATEGORIES.includes(cat.trim());
      };

      if (!validateCategory(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Valid categories are: ${VALID_CATEGORIES.join(', ')}`
        });
      }

      // Insert the menu item
      const { data: menuItem, error: insertError } = await supabase
        .from('menu_items')
        .insert([{
          restaurant_id: vendorId,
          name,
          description: description || null,
          category: category.trim(),
          price: price || null,
          is_veg: is_veg !== undefined ? is_veg : false,
          image_url: image_url || null,
          is_active: true,
          in_stock: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (insertError) {
        console.error('[MenuItems] POST insert error:', insertError.message);
        return res.status(500).json({
          success: false,
          message: 'Failed to create menu item'
        });
      }

      res.status(201).json({ success: true, menuItem });
    } catch (e) {
      console.error('[MenuItems] POST error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  /**
   * PUT /:vendorId/menu-items/:itemId
   * Update an existing menu item
   * Validates: category must be in VALID_CATEGORIES
   * Returns 400 if category is invalid with message listing valid categories
   */
  router.put('/:vendorId/menu-items/:itemId', async (req, res) => {
    try {
      const { vendorId, itemId } = req.params;
      const { name, description, category, price, is_veg, image_url } = req.body;

      // Validate category if provided
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

      const validateCategory = (cat) => {
        if (!cat || typeof cat !== 'string') {
          return false;
        }
        return VALID_CATEGORIES.includes(cat.trim());
      };

      if (category !== undefined && !validateCategory(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Valid categories are: ${VALID_CATEGORIES.join(', ')}`
        });
      }

      // Build update object
      const updateObj = {};
      if (name !== undefined) updateObj.name = name;
      if (description !== undefined) updateObj.description = description;
      if (category !== undefined) updateObj.category = category.trim();
      if (price !== undefined) updateObj.price = price;
      if (is_veg !== undefined) updateObj.is_veg = is_veg;
      if (image_url !== undefined) updateObj.image_url = image_url;
      updateObj.updated_at = new Date().toISOString();

      // Update the menu item
      const { data: menuItem, error: updateError } = await supabase
        .from('menu_items')
        .update(updateObj)
        .eq('id', itemId)
        .eq('restaurant_id', vendorId)
        .select()
        .single();

      if (updateError) {
        if (updateError.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Menu item not found'
          });
        }
        console.error('[MenuItems] PUT update error:', updateError.message);
        return res.status(500).json({
          success: false,
          message: 'Failed to update menu item'
        });
      }

      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: 'Menu item not found'
        });
      }

      res.json({ success: true, menuItem });
    } catch (e) {
      console.error('[MenuItems] PUT error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { createVendorRouter, LUNCH_SLOT, EVENING_SLOT };
