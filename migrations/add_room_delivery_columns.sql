-- Migration: Add number_of_packets and vendor_platform columns
-- to orders and pending_orders tables for external room delivery feature
-- Run this in Supabase SQL Editor

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS number_of_packets INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vendor_platform   TEXT DEFAULT '';

ALTER TABLE pending_orders
  ADD COLUMN IF NOT EXISTS number_of_packets INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vendor_platform   TEXT DEFAULT '';
