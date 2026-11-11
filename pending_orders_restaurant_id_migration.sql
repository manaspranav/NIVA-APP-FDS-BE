-- Migration: Add restaurant_id and vendor_name to pending_orders table
-- This allows the order creation flow to carry restaurant_id and vendor_name through to final order creation
-- Both fields are resolved during /api/payment/create-order and stored in pending_orders

ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES restaurants(id);
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS vendor_name TEXT;
