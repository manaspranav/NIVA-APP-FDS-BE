-- Migration: Restaurant Partner Portal - menu_items table extension
-- Adds in_stock boolean column to support per-item availability toggling.
-- Requirements: 1.4, 1.7

-- Add in_stock column (boolean, NOT NULL, defaults to true).
-- Existing rows will automatically receive in_stock = true via the DEFAULT clause,
-- preserving all existing data without modification.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true;
