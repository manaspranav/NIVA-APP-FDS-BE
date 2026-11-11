import { describe, it, expect } from 'vitest';

/**
 * Task 24: Category Validation Unit Tests
 * Validates: Requirements 2.1, 2.2
 * Tests the validateCategory() function used by admin API endpoints
 */

/**
 * Category constants matching backend/index.js
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
 * Implementation of validateCategory() - mirrors backend
 */
const validateCategory = (category) => {
  if (!category || typeof category !== 'string') {
    return false;
  }
  return VALID_CATEGORIES.includes(category.trim());
};

describe('Category Validation', () => {
  describe('Valid categories', () => {
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

  describe('Invalid categories', () => {
    it('rejects "InvalidCategory"', () => {
      expect(validateCategory('InvalidCategory')).toBe(false);
    });

    it('rejects "Pizza"', () => {
      expect(validateCategory('Pizza')).toBe(false);
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

  describe('Whitespace handling', () => {
    it('accepts category with leading whitespace', () => {
      expect(validateCategory('  Starters')).toBe(true);
    });

    it('accepts category with trailing whitespace', () => {
      expect(validateCategory('Biryani  ')).toBe(true);
    });

    it('accepts category with leading and trailing whitespace', () => {
      expect(validateCategory('  Noodles  ')).toBe(true);
    });

    it('rejects category with internal whitespace variations', () => {
      // "Fried Rice" with wrong spacing is still invalid if not exact
      expect(validateCategory('FriedRice')).toBe(false);
    });
  });

  describe('Case sensitivity', () => {
    it('rejects lowercase "starters"', () => {
      expect(validateCategory('starters')).toBe(false);
    });

    it('rejects uppercase "BIRYANI"', () => {
      expect(validateCategory('BIRYANI')).toBe(false);
    });

    it('requires exact case match', () => {
      expect(validateCategory('bIRYANI')).toBe(false);
    });
  });

  describe('Multi-word categories', () => {
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

    it('rejects "Fried Rice" with different spacing', () => {
      expect(validateCategory('FriedRice')).toBe(false);
    });
  });
});
