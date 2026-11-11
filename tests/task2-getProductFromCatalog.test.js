/**
 * Task 2: Update getProductFromCatalog to use database queries
 * Validates: Requirement 2 and Task 2 Acceptance Criteria
 * Tests that getProductFromCatalog queries Supabase menu_items table correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vendorCatalog from '../lib/vendorCatalog.js';

describe('Task 2: getProductFromCatalog Database Query Function', () => {
  let mockSupabase;
  let mockQuery;

  beforeEach(() => {
    // Setup mock Supabase client
    mockQuery = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    mockSupabase = {
      from: vi.fn().mockReturnValue(mockQuery),
    };
  });

  describe('Acceptance Criteria 1: Function queries Supabase menu_items table', () => {
    it('should call supabase.from() with "menu_items" table name', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(mockSupabase.from).toHaveBeenCalledWith('menu_items');
    });

    it('should call select() with required columns', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(mockQuery.select).toHaveBeenCalledWith(
        'id, name, price, category, image_url, restaurant_id, is_active, in_stock, is_veg, description'
      );
    });
  });

  describe('Acceptance Criteria 2: Filters enforce is_active=true and in_stock=true', () => {
    it('should filter by product id', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(mockQuery.eq).toHaveBeenCalledWith('id', 301);
    });

    it('should filter by is_active=true', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(mockQuery.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('should filter by in_stock=true', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(mockQuery.eq).toHaveBeenCalledWith('in_stock', true);
    });

    it('should filter by restaurant_id when vendorId provided', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, 'test-restaurant', mockSupabase);

      expect(mockQuery.eq).toHaveBeenCalledWith('restaurant_id', 'test-restaurant');
    });
  });

  describe('Acceptance Criteria 3: Returns full product object with price from database', () => {
    it('should return product object with all fields when found and available', async () => {
      const mockProduct = {
        id: 301,
        name: 'Dum Biryani',
        price: 149,
        category: 'Biryani',
        image_url: '/biryani.jpg',
        restaurant_id: 'default-restaurant',
        is_active: true,
        in_stock: true,
        is_veg: false,
        description: 'Authentic dum biryani',
      };

      mockQuery.single.mockResolvedValue({ data: mockProduct, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toEqual({
        id: 301,
        name: 'Dum Biryani',
        price: 149,
        category: 'Biryani',
        image: '/biryani.jpg',
        vendorId: 'default-restaurant',
        is_veg: false,
        description: 'Authentic dum biryani',
        is_active: true,
        in_stock: true,
      });
    });

    it('should parse price as float', async () => {
      const mockProduct = {
        id: 305,
        name: 'Chicken Fried Rice',
        price: '109.50',
        category: 'Fried Rice',
        image_url: '/fried-rice.jpg',
        restaurant_id: 'default-restaurant',
        is_active: true,
        in_stock: true,
        is_veg: false,
        description: 'Tasty fried rice',
      };

      mockQuery.single.mockResolvedValue({ data: mockProduct, error: null });

      const result = await vendorCatalog.getProductFromCatalog(305, 'default-restaurant', mockSupabase);

      expect(result.price).toBe(109.5);
      expect(typeof result.price).toBe('number');
    });

    it('should handle missing optional fields', async () => {
      const mockProduct = {
        id: 301,
        name: 'Dum Biryani',
        price: 149,
        category: 'Biryani',
        image_url: null,
        restaurant_id: 'default-restaurant',
        is_active: true,
        in_stock: true,
        is_veg: false,
        description: null,
      };

      mockQuery.single.mockResolvedValue({ data: mockProduct, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result.image).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe('Acceptance Criteria 4: Returns null if product not found or unavailable', () => {
    it('should return null when product not found (no data)', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(999, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('should return null when product is not active', async () => {
      // This simulates the case where query returns empty due to is_active filter
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('should return null when product is out of stock', async () => {
      // This simulates the case where query returns empty due to in_stock filter
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('should return null when database error occurs', async () => {
      const error = new Error('Database connection failed');
      mockQuery.single.mockResolvedValue({ data: null, error });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('should return null when query throws exception', async () => {
      mockQuery.single.mockRejectedValue(new Error('Query execution failed'));

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });
  });

  describe('Acceptance Criteria - Without Restaurant Filter', () => {
    it('should query without restaurant_id filter when vendorId not provided', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, undefined, mockSupabase);

      // Verify that restaurant_id filter was NOT called
      const eqCalls = mockQuery.eq.mock.calls;
      const hasRestaurantFilter = eqCalls.some(call => call[0] === 'restaurant_id');
      expect(hasRestaurantFilter).toBe(false);
    });

    it('should still filter by id, is_active, in_stock when vendorId not provided', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      await vendorCatalog.getProductFromCatalog(301, undefined, mockSupabase);

      expect(mockQuery.eq).toHaveBeenCalledWith('id', 301);
      expect(mockQuery.eq).toHaveBeenCalledWith('is_active', true);
      expect(mockQuery.eq).toHaveBeenCalledWith('in_stock', true);
    });
  });

  describe('Test Case Examples', () => {
    it('Test Case 1: Create test menu item with is_active=true, call getProductFromCatalog, verify returns product', async () => {
      const mockProduct = {
        id: 301,
        name: 'Dum Biryani',
        price: 149,
        category: 'Biryani',
        image_url: '/biryani.jpg',
        restaurant_id: 'default-restaurant',
        is_active: true,
        in_stock: true,
        is_veg: false,
        description: 'Authentic dum biryani',
      };

      mockQuery.single.mockResolvedValue({ data: mockProduct, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).not.toBeNull();
      expect(result.name).toBe('Dum Biryani');
      expect(result.price).toBe(149);
    });

    it('Test Case 2: Set is_active=false on product, call getProductFromCatalog, verify returns null', async () => {
      // First call returns the product
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('Test Case 3: Set in_stock=false on product, call getProductFromCatalog, verify returns null', async () => {
      // Query filter will exclude the product
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(301, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });

    it('Test Case 4: Call with non-existent product ID, verify returns null', async () => {
      mockQuery.single.mockResolvedValue({ data: null, error: null });

      const result = await vendorCatalog.getProductFromCatalog(99999, 'default-restaurant', mockSupabase);

      expect(result).toBeNull();
    });
  });
});
