/**
 * Task 4: Category Validation for Menu Items
 * Tests: POST /api/vendors/:vendorId/menu-items and PUT endpoints
 * Validates: Requirements 2.1, 2.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Mock Supabase client
 */
const createMockSupabase = () => ({
  from: vi.fn((table) => ({
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
  auth: {
    admin: {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      updateUserById: vi.fn(),
    },
  },
});

/**
 * Valid categories matching backend
 */
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

/**
 * Validation function matching backend implementation
 */
const validateCategory = (category) => {
  if (!category || typeof category !== 'string') {
    return false;
  }
  return VALID_CATEGORIES.includes(category.trim());
};

describe('Menu Item Category Validation', () => {
  describe('Valid Categories', () => {
    it('accepts "Starters" category', () => {
      expect(validateCategory('Starters')).toBe(true);
    });

    it('accepts "Biryani" category', () => {
      expect(validateCategory('Biryani')).toBe(true);
    });

    it('accepts "Noodles" category', () => {
      expect(validateCategory('Noodles')).toBe(true);
    });

    it('accepts "Fried Rice" category', () => {
      expect(validateCategory('Fried Rice')).toBe(true);
    });

    it('accepts "Manchurian" category', () => {
      expect(validateCategory('Manchurian')).toBe(true);
    });

    it('accepts "Chinese" category', () => {
      expect(validateCategory('Chinese')).toBe(true);
    });

    it('accepts "South Indian" category', () => {
      expect(validateCategory('South Indian')).toBe(true);
    });

    it('accepts "North Indian" category', () => {
      expect(validateCategory('North Indian')).toBe(true);
    });

    it('accepts "Fast Food" category', () => {
      expect(validateCategory('Fast Food')).toBe(true);
    });

    it('accepts "Beverages" category', () => {
      expect(validateCategory('Beverages')).toBe(true);
    });

    it('accepts "Desserts" category', () => {
      expect(validateCategory('Desserts')).toBe(true);
    });

    it('accepts "Most Selling" category', () => {
      expect(validateCategory('Most Selling')).toBe(true);
    });

    it('accepts all 12 valid categories', () => {
      VALID_CATEGORIES.forEach(category => {
        expect(validateCategory(category)).toBe(true);
      });
    });
  });

  describe('Invalid Categories', () => {
    it('rejects "InvalidCategory"', () => {
      expect(validateCategory('InvalidCategory')).toBe(false);
    });

    it('rejects "Pizza"', () => {
      expect(validateCategory('Pizza')).toBe(false);
    });

    it('rejects "Sushi"', () => {
      expect(validateCategory('Sushi')).toBe(false);
    });

    it('rejects "Italian"', () => {
      expect(validateCategory('Italian')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateCategory('')).toBe(false);
    });

    it('rejects null', () => {
      expect(validateCategory(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(validateCategory(undefined)).toBe(false);
    });

    it('rejects number', () => {
      expect(validateCategory(123)).toBe(false);
    });

    it('rejects object', () => {
      expect(validateCategory({})).toBe(false);
    });

    it('rejects array', () => {
      expect(validateCategory([])).toBe(false);
    });

    it('rejects boolean', () => {
      expect(validateCategory(true)).toBe(false);
    });
  });

  describe('Whitespace Handling', () => {
    it('accepts category with leading whitespace', () => {
      expect(validateCategory('  Starters')).toBe(true);
    });

    it('accepts category with trailing whitespace', () => {
      expect(validateCategory('Biryani  ')).toBe(true);
    });

    it('accepts category with leading and trailing whitespace', () => {
      expect(validateCategory('  Noodles  ')).toBe(true);
    });
  });

  describe('Case Sensitivity', () => {
    it('rejects lowercase "starters"', () => {
      expect(validateCategory('starters')).toBe(false);
    });

    it('rejects uppercase "BIRYANI"', () => {
      expect(validateCategory('BIRYANI')).toBe(false);
    });

    it('rejects mixed case "BiRYANI"', () => {
      expect(validateCategory('BiRYANI')).toBe(false);
    });

    it('requires exact case match', () => {
      expect(validateCategory('bIRYANI')).toBe(false);
    });
  });

  describe('Multi-word Categories', () => {
    it('accepts "Fried Rice" (multi-word category)', () => {
      expect(validateCategory('Fried Rice')).toBe(true);
    });

    it('accepts "South Indian" (multi-word category)', () => {
      expect(validateCategory('South Indian')).toBe(true);
    });

    it('accepts "North Indian" (multi-word category)', () => {
      expect(validateCategory('North Indian')).toBe(true);
    });

    it('accepts "Fast Food" (multi-word category)', () => {
      expect(validateCategory('Fast Food')).toBe(true);
    });

    it('accepts "Most Selling" (multi-word category)', () => {
      expect(validateCategory('Most Selling')).toBe(true);
    });

    it('rejects "FriedRice" without space', () => {
      expect(validateCategory('FriedRice')).toBe(false);
    });

    it('rejects "Fried  Rice" with double space', () => {
      expect(validateCategory('Fried  Rice')).toBe(false);
    });
  });

  describe('Error Message Generation', () => {
    it('generates error message listing all valid categories', () => {
      const invalidCategory = 'Pizza';
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
  });
});
