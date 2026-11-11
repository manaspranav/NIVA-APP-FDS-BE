-- Database Migration: Room Delivery Enhancements
-- Adds new columns for COD tracking, settlements, and penalty fees to `orders` and `pending_orders` tables

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_tax DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS penalty_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gate_confirmation BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS maintenance_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_breakdown JSONB;

ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(255);
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS cod_tax DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS penalty_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS gate_confirmation BOOLEAN DEFAULT false;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS partner_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS vendor_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS maintenance_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS settlement_breakdown JSONB;
