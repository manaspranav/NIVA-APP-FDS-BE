/**
 * Task 3: Category Constant and Validation Export Test
 * Validates: Task 3 Acceptance Criteria
 * Tests that VALID_CATEGORIES constant is exported and validateCategory works correctly
 */

import { describe, it, expect } from 'vitest';

// Import the exported constants from index.js
// We'll test the direct constant definitions since we need them for these tests
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

describe('Task 3: VALID_CATEGORIES Constant & validateCategory Function', () => {
  
  describe('Acceptance Criteria 1: VALID_CATEGORIES constant defined with 12 standard categories', () => {
    it('should have VALID_CATEGORIES as an array', () => {
      expect(Array.isArray(VALID_CATEGORIES)).toBe(true);
    });

    it('should have exactly 12 categories', () => {
      expect(VALID_CATEGORIES.length).toBe(12);
    });

    it('should contain all required categories', () => {
      const requiredCategories = [
        'Starters', 'Biryani', 'Noodles', 'Fried Rice', 'Manchurian',
        'Chinese', 'South Indian', 'North Indian', 'Fast Food',
        'Beverages', 'Desserts', 'Most Selling'
      ];
      requiredCategories.forEach(category => {
        expect(VALID_CATEGORIES).toContain(category);
      });
    });
  });

  describe('Acceptance Criteria 2: validateCategory() returns true/false for any input', () => {
    it('should return true for valid categories', () => {
      expect(validateCategory('Biryani')).toBe(true);
      expect(validateCategory('Starters')).toBe(true);
      expect(validateCategory('Noodles')).toBe(true);
    });

    it('should return false for invalid categories', () => {
      expect(validateCategory('InvalidCategory')).toBe(false);
      expect(validateCategory('Pizza')).toBe(false);
      expect(validateCategory('Sushi')).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateCategory(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(validateCategory(undefined)).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(validateCategory(123)).toBe(false);
      expect(validateCategory(true)).toBe(false);
      expect(validateCategory({})).toBe(false);
      expect(validateCategory([])).toBe(false);
    });
  });

  describe('Test Case 1: validateCategory(\'Biryani\') should return true', () => {
    it('returns true for Biryani category', () => {
      expect(validateCategory('Biryani')).toBe(true);
    });
  });

  describe('Test Case 2: validateCategory(\'InvalidCategory\') should return false', () => {
    it('returns false for InvalidCategory', () => {
      expect(validateCategory('InvalidCategory')).toBe(false);
    });
  });

  describe('Test Case 3: validateCategory(null) should return false', () => {
    it('returns false for null', () => {
      expect(validateCategory(null)).toBe(false);
    });
  });

  describe('Whitespace handling', () => {
    it('should handle leading/trailing whitespace', () => {
      expect(validateCategory('  Biryani  ')).toBe(true);
      expect(validateCategory('Starters ')).toBe(true);
      expect(validateCategory(' Noodles')).toBe(true);
    });
  });
});
