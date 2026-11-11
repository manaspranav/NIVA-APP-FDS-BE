/**
 * Server-side hardcoded menus — must match frontend data/menus/*
 */
const NIVA_FASTFOODS = [
  { id: 301, name: 'Dum Biryani', price: 149, originalPrice: 200, type: 'fastfood', category: 'Biryani', image: '/BIryani/DumBiryani.png', vendorId: 'niva-fastfoods' },
  { id: 302, name: 'Fry Biryani', price: 159, originalPrice: 210, type: 'fastfood', category: 'Biryani', image: '/BIryani/FryBiryani.png', vendorId: 'niva-fastfoods' },
  { id: 303, name: 'Biryani Combo', price: 169, originalPrice: 220, type: 'fastfood', category: 'Biryani', image: '/Combo/BiryaniCombo.png', vendorId: 'niva-fastfoods' },
  { id: 304, name: 'Chicken Fried Rice + Thums Up Combo', price: 139, originalPrice: 169, type: 'fastfood', category: 'Biryani', image: '/Combo/FriedRiceCombo.png', vendorId: 'niva-fastfoods' },
  { id: 305, name: 'Chicken Fried Rice', price: 109, originalPrice: 120, type: 'fastfood', category: 'Fried Rice', image: '/FriedRice/ChickenFriedRice.png', vendorId: 'niva-fastfoods' },
  { id: 306, name: 'Egg Fried Rice', price: 79, originalPrice: 99, type: 'fastfood', category: 'Fried Rice', image: '/FriedRice/EggFriedRice.png', vendorId: 'niva-fastfoods' },
  { id: 307, name: 'Veg Fried Rice', price: 89, originalPrice: 89, type: 'fastfood', category: 'Fried Rice', image: '/FriedRice/VegFriedRice.png', vendorId: 'niva-fastfoods' },
  { id: 308, name: 'Veg Manchurian Fried Rice', price: 99, originalPrice: 99, type: 'fastfood', category: 'Fried Rice', image: '/FriedRice/VegManchurianRice.png', vendorId: 'niva-fastfoods' },
  { id: 309, name: 'Chicken Noodles', price: 109, originalPrice: 120, type: 'fastfood', category: 'Noodles', image: '/Noodles/ChickenNoodles.png', vendorId: 'niva-fastfoods' },
  { id: 310, name: 'Egg Noodles', price: 79, originalPrice: 99, type: 'fastfood', category: 'Noodles', image: '/Noodles/EggNoodles.png', vendorId: 'niva-fastfoods' },
  { id: 311, name: 'Veg Manchurian Noodles', price: 99, originalPrice: 99, type: 'fastfood', category: 'Noodles', image: '/Noodles/VegManchurianNoodles.png', vendorId: 'niva-fastfoods' },
  { id: 312, name: 'Veg Noodles', price: 89, originalPrice: 89, type: 'fastfood', category: 'Noodles', image: '/Noodles/VegNoodles.png', vendorId: 'niva-fastfoods' },
  { id: 313, name: 'Chicken Manchurian', price: 189, originalPrice: 220, type: 'fastfood', category: 'Starters', image: '/Starters/ChickenManchurian.png', vendorId: 'niva-fastfoods' },
  { id: 314, name: 'Chilli Chicken', price: 189, originalPrice: 220, type: 'fastfood', category: 'Starters', image: '/Starters/ChilliChicken.png', vendorId: 'niva-fastfoods' },
  { id: 315, name: 'Veg Manchurian', price: 89, originalPrice: 99, type: 'fastfood', category: 'Starters', image: '/Starters/VegManchurian.png', vendorId: 'niva-fastfoods' },
  { id: 316, name: 'Chicken Haleem', price: 209, originalPrice: 299, type: 'fastfood', category: 'Specials', image: '/Haleem/Haleem.png', vendorId: 'niva-fastfoods' },
];

const LOCAL_HOME_KITCHEN = [
  { id: 401, name: 'Chicken Biryani', price: 129, originalPrice: 159, type: 'homekitchen', category: 'Biryani', image: '/restaurants/local-home-kitchen/biryani.jpg', vendorId: 'local-home-kitchen' },
  { id: 402, name: 'Veg Meals (Full)', price: 89, originalPrice: 99, type: 'homekitchen', category: 'Meals', image: '/restaurants/local-home-kitchen/meals.jpg', vendorId: 'local-home-kitchen' },
  { id: 403, name: 'Chicken Fried Rice', price: 99, originalPrice: 119, type: 'homekitchen', category: 'Fried Rice', image: '/restaurants/local-home-kitchen/fried-rice.jpg', vendorId: 'local-home-kitchen' },
  { id: 404, name: 'Egg Curry & Rice', price: 79, originalPrice: 89, type: 'homekitchen', category: 'Curry', image: '/restaurants/local-home-kitchen/curry.jpg', vendorId: 'local-home-kitchen' },
  { id: 405, name: 'Veg Fried Rice', price: 79, originalPrice: 89, type: 'homekitchen', category: 'Fried Rice', image: '/restaurants/local-home-kitchen/veg-fried-rice.jpg', vendorId: 'local-home-kitchen' },
  { id: 406, name: 'Evening Snacks Plate', price: 59, originalPrice: 69, type: 'homekitchen', category: 'Snacks', image: '/restaurants/local-home-kitchen/snacks.jpg', vendorId: 'local-home-kitchen' },
];

const CATALOG = {
  'niva-fastfoods': NIVA_FASTFOODS,
  'local-home-kitchen': LOCAL_HOME_KITCHEN,
};

const DEFAULT_VENDOR_ID = 'niva-fastfoods';

// In-memory cache for database-sourced menu items to reduce DB queries
// Format: { 'vendorId:restaurantId': [menuItems...] }
const menuItemsCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = {};

async function getProductFromCatalog(productId, vendorId, supabase) {
  console.log(`[vendorCatalog] Looking up product - ID: ${productId}, Restaurant: ${vendorId}`);

  // All product lookups now go through database for consistency
  if (supabase) {
    try {
      console.log(`[vendorCatalog] Querying database for product from menu_items table...`);
      
      // Query database for product with availability filters
      // Note: vendor parameter (restaurantId) is used to scope the query to a specific restaurant
      let query = supabase
        .from('menu_items')
        .select('id, name, price, category, image_url, restaurant_id, is_active, in_stock, is_veg, description')
        .eq('id', productId)
        .eq('is_active', true)
        .eq('in_stock', true);
      
      // If vendorId (restaurantId) provided, filter by restaurant
      if (vendorId) {
        query = query.eq('restaurant_id', vendorId);
      }
      
      const result = await query.single();
      
      const dbItems = result.data;
      const error = result.error;

      if (!error && dbItems) {
        console.log(`[vendorCatalog] Found in database: ${dbItems.name}, Price: ${dbItems.price}, Restaurant: ${dbItems.restaurant_id}`);
        return {
          id: dbItems.id,
          name: dbItems.name,
          price: parseFloat(dbItems.price),
          category: dbItems.category || 'Other',
          image: dbItems.image_url || null,
          vendorId: dbItems.restaurant_id,
          is_veg: dbItems.is_veg || false,
          description: dbItems.description || null,
          is_active: dbItems.is_active,
          in_stock: dbItems.in_stock
        };
      }

      if (error) {
        console.error('[vendorCatalog] Database error looking up product:', error.message);
        // Product not found or filters didn't match
      } else {
        console.log(`[vendorCatalog] Product not found in database or unavailable: ${productId}`);
      }
    } catch (dbError) {
      console.error('[vendorCatalog] Error looking up product in menu_items table:', dbError);
      // Fall through to return null - let caller handle missing product
    }
  }

  console.log(`[vendorCatalog] Product not found or not available: ${productId}`);
  return null;
}

async function getProductByName(name, vendorId, supabase) {
  if (!name) return null;

  const vid = vendorId || DEFAULT_VENDOR_ID;
  const searchName = name.toLowerCase().trim();

  console.log(`[vendorCatalog] Looking up product by name: "${name}", Vendor: ${vid}`);

  // All product lookups now go through database for consistency
  if (supabase) {
    try {
      console.log(`[vendorCatalog] Querying database for product by name...`);
      
      // Search database for product by name with availability filters
      const { data: dbItems, error } = await supabase
        .from('menu_items')
        .select('id, name, price, category, image_url, restaurant_id, is_active, in_stock, is_veg, description')
        .ilike('name', name)
        .eq('is_active', true)
        .eq('in_stock', true)
        .maybeSingle();

      if (!error && dbItems) {
        console.log(`[vendorCatalog] Found by name in database: ${dbItems.name}, Price: ${dbItems.price}`);
        return {
          id: dbItems.id,
          name: dbItems.name,
          price: parseFloat(dbItems.price),
          category: dbItems.category || 'Other',
          image: dbItems.image_url || null,
          type: 'restaurant',
          vendorId: dbItems.restaurant_id,
          is_veg: dbItems.is_veg || false,
          description: dbItems.description || null,
          is_active: dbItems.is_active,
          in_stock: dbItems.in_stock
        };
      }

      if (error) {
        console.error('[vendorCatalog] Database error looking up product by name:', error.message);
      } else {
        console.log(`[vendorCatalog] Product not found by name or unavailable: ${name}`);
      }
    } catch (dbError) {
      console.error('[vendorCatalog] Error looking up product by name in menu_items:', dbError);
      // Fall through to return null - let caller handle missing product
    }
  }

  // Fallback: Check hardcoded catalog only if database is unavailable
  if (!supabase) {
    console.log(`[vendorCatalog] Database not available, falling back to hardcoded catalog for name lookup`);
    const menu = CATALOG[vid] || [];
    const found = menu.find((p) => p.name.toLowerCase() === searchName);
    if (found) {
      console.log(`[vendorCatalog] Found by name in hardcoded catalog: ${found.name}`);
      return found;
    }
  }

  console.log(`[vendorCatalog] Product not found by name: ${name}`);
  return null;
}

module.exports = {
  CATALOG,
  DEFAULT_VENDOR_ID,
  getProductFromCatalog,
  getProductByName,
  NIVA_FASTFOODS,
  LOCAL_HOME_KITCHEN,
};
