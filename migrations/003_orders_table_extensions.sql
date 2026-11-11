-- ============================================================================
-- MIGRATION 003: Orders Table Extensions for Restaurant Partner Portal
-- ============================================================================
-- PURPOSE: Extend the orders table to support the Restaurant Partner Portal:
--   1. Add restaurant_id FK linking orders to restaurants
--   2. Extend status CHECK constraint with new kitchen/delivery statuses
--   3. Add timestamp columns for status transition tracking
--
-- SAFETY: Uses IF NOT EXISTS / IF EXISTS patterns for idempotent re-runs.
--         All existing rows are preserved without data loss.
--
-- RUN THIS IN: Supabase SQL Editor (https://app.supabase.com → SQL Editor)
-- ============================================================================

-- ========================================
-- STEP 1: Add restaurant_id column (FK to restaurants.id)
-- ========================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES restaurants(id);

-- ========================================
-- STEP 2: Drop existing status check constraints and create new one
-- ========================================
-- Drop both possible constraint names (varies by migration history)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS valid_status;

-- Create new CHECK constraint accepting all status values:
-- Original statuses: placed, taken, out_for_delivery, delivered, cancelled, rejected, ready, completed
-- New restaurant partner statuses: pending, accepted, preparing, ready_for_pickup, picked_up
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'placed',
    'pending',
    'accepted',
    'preparing',
    'ready_for_pickup',
    'picked_up',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'rejected',
    'ready',
    'completed',
    'taken'
  ));

-- ========================================
-- STEP 3: Add timestamp columns for status transitions
-- ========================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparing_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_pickup_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;

-- ========================================
-- STEP 4: Add index on restaurant_id for efficient portal queries
-- ========================================
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON orders(restaurant_id);

-- ============================================================================
-- VERIFICATION: Confirm new columns exist
-- ============================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('restaurant_id', 'accepted_at', 'preparing_at', 'ready_for_pickup_at', 'picked_up_at')
ORDER BY column_name;

-- ============================================================================
-- EXPECTED OUTPUT: 5 rows showing:
--   accepted_at          | timestamp with time zone | YES
--   picked_up_at         | timestamp with time zone | YES
--   preparing_at         | timestamp with time zone | YES
--   ready_for_pickup_at  | timestamp with time zone | YES
--   restaurant_id        | uuid                     | YES
-- ============================================================================
