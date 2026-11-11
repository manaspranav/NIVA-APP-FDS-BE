-- Migration: Add delivery_mode column to orders and pending_orders tables
-- Purpose: Store delivery mode ('instant' or 'slot') for distinguishing instant vs slot delivery
-- Run in: Supabase SQL Editor

-- ============================================================================
-- STEP 1: Add delivery_mode column to orders table
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
-- Valid values: 'instant', 'slot', or NULL for backward compatibility

-- ============================================================================
-- STEP 2: Add delivery_mode column to pending_orders table  
-- ============================================================================
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
-- Valid values: 'instant', 'slot', or NULL for backward compatibility

-- ============================================================================
-- STEP 3: Create indexes for efficient filtering (optional, for future queries)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_orders_delivery_mode ON orders(delivery_mode);
CREATE INDEX IF NOT EXISTS idx_pending_orders_delivery_mode ON pending_orders(delivery_mode);

-- ============================================================================
-- STEP 4: Verification - Check columns were added
-- ============================================================================
-- Run this query to confirm columns exist:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name IN ('orders', 'pending_orders') 
-- AND column_name = 'delivery_mode'
-- ORDER BY table_name, column_name;
-- 
-- Expected result: 2 rows (one for each table)
-- ============================================================================
