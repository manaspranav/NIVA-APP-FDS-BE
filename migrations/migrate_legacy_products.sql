-- Migration: Migrate 16 legacy products to database
-- Transforms hardcoded products from PRODUCT_CATALOG into menu_items table
-- Assigns all legacy products to a default restaurant
-- This enables the transition from hardcoded catalog to database-driven system

-- ========================================
-- 1. Ensure default restaurant exists
-- ========================================
INSERT INTO restaurants (id, name, cuisine, location, is_active, restaurant_available, created_at)
VALUES (
  'default-legacy-restaurant',
  'NIVA Legacy Products',
  'Multi-Cuisine',
  'Default',
  true,
  true,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 2. Insert 16 legacy products
-- ========================================

-- Biryani Category (4 items)
INSERT INTO menu_items (id, restaurant_id, name, price, description, category, is_veg, is_active, in_stock, created_at)
VALUES
(301, 'default-legacy-restaurant', 'Dum Biryani', 149, 'Authentic dum biryani cooked with aromatic rice and spices', 'Biryani', false, true, true, NOW()),
(302, 'default-legacy-restaurant', 'Fry Biryani', 159, 'Crispy fried biryani with tender meat and fragrant rice', 'Biryani', false, true, true, NOW()),
(303, 'default-legacy-restaurant', 'Biryani Combo', 169, 'Complete biryani meal with raita and salad', 'Biryani', false, true, true, NOW()),
(304, 'default-legacy-restaurant', 'Chicken Fried Rice + Thums Up Combo', 139, 'Chicken fried rice served with cold Thums Up beverage', 'Biryani', false, true, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Fried Rice Category (4 items)
INSERT INTO menu_items (id, restaurant_id, name, price, description, category, is_veg, is_active, in_stock, created_at)
VALUES
(305, 'default-legacy-restaurant', 'Chicken Fried Rice', 109, 'Flavorful chicken fried rice with fresh vegetables', 'Fried Rice', false, true, true, NOW()),
(306, 'default-legacy-restaurant', 'Egg Fried Rice', 79, 'Delicious egg fried rice with a touch of soy sauce', 'Fried Rice', true, true, true, NOW()),
(307, 'default-legacy-restaurant', 'Veg Fried Rice', 89, 'Nutritious vegetable fried rice with mixed veggies', 'Fried Rice', true, true, true, NOW()),
(308, 'default-legacy-restaurant', 'Veg Manchurian Fried Rice', 99, 'Fried rice topped with crispy vegetable manchurian', 'Fried Rice', true, true, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Noodles Category (4 items)
INSERT INTO menu_items (id, restaurant_id, name, price, description, category, is_veg, is_active, in_stock, created_at)
VALUES
(309, 'default-legacy-restaurant', 'Chicken Noodles', 109, 'Tender chicken noodles cooked with special sauce', 'Noodles', false, true, true, NOW()),
(310, 'default-legacy-restaurant', 'Egg Noodles', 79, 'Soft egg noodles with a delicate flavor', 'Noodles', true, true, true, NOW()),
(311, 'default-legacy-restaurant', 'Veg Manchurian Noodles', 99, 'Noodles topped with crispy vegetable manchurian', 'Noodles', true, true, true, NOW()),
(312, 'default-legacy-restaurant', 'Veg Noodles', 89, 'Mixed vegetable noodles with aromatic spices', 'Noodles', true, true, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Starters Category (3 items)
INSERT INTO menu_items (id, restaurant_id, name, price, description, category, is_veg, is_active, in_stock, created_at)
VALUES
(313, 'default-legacy-restaurant', 'Chicken Manchurian', 189, 'Crispy chicken pieces in tangy manchurian sauce', 'Starters', false, true, true, NOW()),
(314, 'default-legacy-restaurant', 'Chilli Chicken', 189, 'Spicy chilli chicken with green peppers and onions', 'Starters', false, true, true, NOW()),
(315, 'default-legacy-restaurant', 'Veg Manchurian', 89, 'Vegetable fritters in delicious manchurian sauce', 'Starters', true, true, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Specials Category (1 item)
INSERT INTO menu_items (id, restaurant_id, name, price, description, category, is_veg, is_active, in_stock, created_at)
VALUES
(316, 'default-legacy-restaurant', 'Chicken Haleem', 209, 'Slow-cooked chicken haleem with fragrant spices', 'Starters', false, true, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 3. Verification Queries (run separately)
-- ========================================
-- Verify count:
-- SELECT COUNT(*) as total_products FROM menu_items WHERE id >= 301 AND id <= 316;
--
-- Verify categories:
-- SELECT DISTINCT category FROM menu_items WHERE id >= 301 AND id <= 316 ORDER BY category;
--
-- Verify prices:
-- SELECT MIN(price) as min_price, MAX(price) as max_price FROM menu_items WHERE id >= 301 AND id <= 316;
--
-- Verify all items are active and in stock:
-- SELECT COUNT(*) as count_active_in_stock FROM menu_items 
-- WHERE id >= 301 AND id <= 316 AND is_active = true AND in_stock = true;
