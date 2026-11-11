-- Add food_amount column to orders and pending_orders tables
-- This column stores the COD food bill amount for external room deliveries

ALTER TABLE orders ADD COLUMN IF NOT EXISTS food_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS food_amount DECIMAL(10, 2) DEFAULT 0;

-- Add description column for order notes/instructions (if needed)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS description TEXT;
