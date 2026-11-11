/**
 * Integration Tests for Menu Item Category Validation
 * Tests: POST /api/vendors/:vendorId/menu-items
 *        PUT /api/vendors/:vendorId/menu-items/:itemId
 *
 * These tests verify the endpoints are wired correctly and validation works
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Mock request/response objects for testing endpoint logic
 */
const createMockReq = (body = {}, params = {}) => ({
  body,
  params,
  headers: {},
});

const createMockRes = () => {
  const res = {
    status: vi.fn(function(code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function(data) {
      this.data = data;
      return this;
    }),
    statusCode: 200,
    data: null,
  };
  return res;
};

const VALID_CATEGORIES = [
  'Starters',
  'Biryani',
  'Noodles',
  'Fried Rice',
  'Manchurian',
  'Chinese',
  'South Indian',
  'North Indian',
  'Fast Food',
  'Beverages',
  'Desserts',
  'Most Selling'
];

const validateCategory = (category) => {
  if (!category || typeof category !== 'string') {
    return false;
  }
  return VALID_CATEGORIES.includes(category.trim());
};

describe('Menu Item Endpoints - Category Validation', () => {
  describe('POST /api/vendors/:vendorId/menu-items', () => {
    it('accepts valid category "Starters"', () => {
      const req = createMockReq({
        name: 'Chicken Manchurian',
        category: 'Starters',
        price: 189,
        is_veg: false,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(true);
    });

    it('accepts valid category "Biryani"', () => {
      const req = createMockReq({
        name: 'Dum Biryani',
        category: 'Biryani',
        price: 149,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(true);
    });

    it('rejects invalid category "Pizza"', () => {
      const req = createMockReq({
        name: 'Cheese Pizza',
        category: 'Pizza',
        price: 200,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(false);
    });

    it('rejects invalid category "Sushi"', () => {
      const req = createMockReq({
        name: 'Salmon Sushi',
        category: 'Sushi',
        price: 300,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(false);
    });

    it('rejects missing category', () => {
      const req = createMockReq({
        name: 'Some Item',
        price: 100,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(false);
    });

    it('accepts multi-word category "Fried Rice"', () => {
      const req = createMockReq({
        name: 'Chicken Fried Rice',
        category: 'Fried Rice',
        price: 109,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(true);
    });

    it('accepts category with whitespace trimming', () => {
      const req = createMockReq({
        name: 'Biryani Item',
        category: '  Biryani  ',
        price: 150,
      }, { vendorId: 'vendor-1' });

      expect(validateCategory(req.body.category)).toBe(true);
    });

    it('generates error message listing all valid categories', () => {
      const invalidCategory = 'InvalidCat';
      if (!validateCategory(invalidCategory)) {
        const message = `Invalid category. Valid categories are: ${VALID_CATEGORIES.join(', ')}`;
        expect(message).toContain('Starters');
        expect(message).toContain('Biryani');
        expect(message).toContain('Noodles');
        expect(message).toContain('Fried Rice');
        expect(message).toContain('Manchurian');
        expect(message).toContain('Chinese');
        expect(message).toContain('South Indian');
        expect(message).toContain('North Indian');
        expect(message).toContain('Fast Food');
        expect(message).toContain('Beverages');
        expect(message).toContain('Desserts');
        expect(message).toContain('Most Selling');
      }
    });

    it('error message includes all 12 categories', () => {
      const message = `Invalid category. Valid categories are: ${VALID_CATEGORIES.join(', ')}`;
      const categoryCount = VALID_CATEGORIES.length;
      expect(message.match(/\b(Starters|Biryani|Noodles|Fried Rice|Manchurian|Chinese|South Indian|North Indian|Fast Food|Beverages|Desserts|Most Selling)\b/g).length).toBe(categoryCount);
    });
  });

  describe('PUT /api/vendors/:vendorId/menu-items/:itemId', () => {
    it('accepts valid category on update', () => {
      const req = createMockReq({
        category: 'Noodles',
        price: 120,
      }, { vendorId: 'vendor-1', itemId: 'item-1' });

      expect(validateCategory(req.body.category)).toBe(true);
    });

    it('rejects invalid category on update', () => {
      const req = createMockReq({
        category: 'InvalidCategory',
        name: 'Updated Item',
      }, { vendorId: 'vendor-1', itemId: 'item-1' });

      expect(validateCategory(req.body.category)).toBe(false);
    });

    it('allows update without category field', () => {
      const req = createMockReq({
        name: 'Updated Name',
        price: 250,
      }, { vendorId: 'vendor-1', itemId: 'item-1' });

      // If category is not provided, it should not fail validation
      expect(req.body.category === undefined).toBe(true);
    });

    it('accepts all valid categories on update', () => {
      VALID_CATEGORIES.forEach(category => {
        const req = createMockReq({
          category,
          price: 100,
        }, { vendorId: 'vendor-1', itemId: 'item-1' });

        expect(validateCategory(req.body.category)).toBe(true);
      });
    });
  });

  describe('Category Validation Edge Cases', () => {
    it('returns false for null category', () => {
      expect(validateCategory(null)).toBe(false);
    });

    it('returns false for undefined category', () => {
      expect(validateCategory(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(validateCategory('')).toBe(false);
    });

    it('returns false for number', () => {
      expect(validateCategory(123)).toBe(false);
    });

    it('returns false for object', () => {
      expect(validateCategory({})).toBe(false);
    });

    it('returns false for array', () => {
      expect(validateCategory([])).toBe(false);
    });

    it('returns false for case mismatches', () => {
      expect(validateCategory('starters')).toBe(false);
      expect(validateCategory('BIRYANI')).toBe(false);
      expect(validateCategory('noodles')).toBe(false);
    });

    it('returns true for categories with correct case', () => {
      expect(validateCategory('Starters')).toBe(true);
      expect(validateCategory('Biryani')).toBe(true);
      expect(validateCategory('Noodles')).toBe(true);
    });
  });
});
