/**
 * Order Restaurant Resolver
 * 
 * Determines the restaurant_id for an order based on its line items.
 * Enforces the single-restaurant constraint: all items in an order must
 * belong to the same restaurant.
 * 
 * Validates: Requirements 14.1, 14.2, 14.3
 */
const { getSupabase } = require('./supabase');

/**
 * Resolve the restaurant_id for an order's line items by looking up
 * each item in the `menu_items` table.
 * 
 * @param {Array} items - Array of cart items with `id` (and optionally `name`)
 * @param {Object} [options] - Optional options
 * @param {Object} [options.supabase] - Supabase client to use (for testing)
 * @returns {Object} { restaurantId: string|null, error: string|null }
 *   - restaurantId: The single restaurant UUID if all items belong to one restaurant,
 *     or null if items are not found in menu_items (legacy catalog items)
 *   - error: Error message if items span multiple restaurants
 */
async function resolveRestaurantFromItems(items, options = {}) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { restaurantId: null, error: null };
  }

  const supabase = options.supabase || getSupabase();

  // Extract item IDs from the cart
  const itemIds = items
    .map(item => item.id)
    .filter(id => id != null);

  if (itemIds.length === 0) {
    return { restaurantId: null, error: null };
  }

  // Look up items in the menu_items table to get their restaurant_id
  const { data: menuItems, error: dbError } = await supabase
    .from('menu_items')
    .select('id, restaurant_id')
    .in('id', itemIds);

  if (dbError) {
    console.error('[ORDER_RESOLVER] Error querying menu_items:', dbError.message);
    // Don't block order creation if DB lookup fails for legacy items
    return { restaurantId: null, error: null };
  }

  // If no items found in menu_items table, these are legacy catalog items
  if (!menuItems || menuItems.length === 0) {
    return { restaurantId: null, error: null };
  }

  // Collect unique restaurant IDs from the found menu items
  const restaurantIds = [...new Set(
    menuItems
      .map(item => item.restaurant_id)
      .filter(id => id != null)
  )];

  // If no restaurant_id found on any items, treat as legacy
  if (restaurantIds.length === 0) {
    return { restaurantId: null, error: null };
  }

  // If items span multiple restaurants, reject
  if (restaurantIds.length > 1) {
    return {
      restaurantId: null,
      error: 'Order cannot span multiple restaurants'
    };
  }

  // All items belong to a single restaurant
  return { restaurantId: restaurantIds[0], error: null };
}

/**
 * Determine the initial order status and delivery_type for an order.
 * Room delivery orders start as 'placed' (paid and ready for partner pickup).
 * 
 * @param {string} deliveryType - The delivery type ('room' or 'normal')
 * @param {string} defaultStatus - The default status if not a room delivery
 * @returns {Object} { status, deliveryType }
 */
function resolveOrderStatusAndDeliveryType(deliveryType, defaultStatus = 'placed') {
  if (deliveryType === 'room') {
    // Room delivery orders are paid — set to 'placed' so partners can see and take them.
    return { status: 'placed', deliveryType: 'room' };
  }
  return { status: defaultStatus, deliveryType: deliveryType || 'normal' };
}

module.exports = {
  resolveRestaurantFromItems,
  resolveOrderStatusAndDeliveryType,
};
