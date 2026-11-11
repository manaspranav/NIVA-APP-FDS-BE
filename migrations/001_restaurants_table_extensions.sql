-- Migration: Restaurant Partner Portal - restaurants table extensions
-- Adds owner credentials and availability columns to support the Restaurant Owner role.
-- Requirements: 1.1, 1.2, 1.3, 1.7

-- Add owner_phone column (text, nullable - uniqueness enforced via partial index)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS owner_phone text;

-- Add owner_password_hash column (text, nullable until admin sets a password)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS owner_password_hash text;

-- Add restaurant_available column (boolean, defaults to true so existing restaurants remain open)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS restaurant_available boolean NOT NULL DEFAULT true;

-- Create partial unique index on owner_phone for non-null values only.
-- This ensures no two restaurants share the same phone while allowing multiple NULL entries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_owner_phone
  ON restaurants (owner_phone)
  WHERE owner_phone IS NOT NULL;
