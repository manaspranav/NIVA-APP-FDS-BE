import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRestaurantFromItems, resolveOrderStatusAndDeliveryType } from './orderRestaurantResolver.js';

/**
 * Creates a mock Supabase client that returns the given data/error from
 * a chained `.from().select().in()` call.
 */
function createMockSupabase(resolvedValue) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

describe('orderRestaurantResolver', () => {
  describe('resolveRestaurantFromItems', () => {
    it('returns null restaurantId for empty items array', async () => {
      const result = await resolveRestaurantFromItems([]);
      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('returns null restaurantId for null items', async () => {
      const result = await resolveRestaurantFromItems(null);
      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('returns null restaurantId for undefined items', async () => {
      const result = await resolveRestaurantFromItems(undefined);
      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('returns null restaurantId when no items found in menu_items table (legacy catalog)', async () => {
      const mockSupabase = createMockSupabase({ data: [], error: null });

      const items = [{ id: 301, name: 'Dum Biryani', quantity: 2 }];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: null, error: null });
      expect(mockSupabase.from).toHaveBeenCalledWith('menu_items');
    });

    it('returns the restaurant_id when all items belong to same restaurant', async () => {
      const restaurantUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockSupabase = createMockSupabase({
        data: [
          { id: 'item-1', restaurant_id: restaurantUuid },
          { id: 'item-2', restaurant_id: restaurantUuid },
        ],
        error: null,
      });

      const items = [
        { id: 'item-1', name: 'Biryani', quantity: 1 },
        { id: 'item-2', name: 'Noodles', quantity: 2 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: restaurantUuid, error: null });
    });

    it('returns error when items span multiple restaurants', async () => {
      const restaurant1 = '123e4567-e89b-12d3-a456-426614174000';
      const restaurant2 = '987e6543-e21b-12d3-a456-426614174000';
      const mockSupabase = createMockSupabase({
        data: [
          { id: 'item-1', restaurant_id: restaurant1 },
          { id: 'item-2', restaurant_id: restaurant2 },
        ],
        error: null,
      });

      const items = [
        { id: 'item-1', name: 'Biryani', quantity: 1 },
        { id: 'item-2', name: 'Noodles', quantity: 2 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({
        restaurantId: null,
        error: 'Order cannot span multiple restaurants',
      });
    });

    it('returns null restaurantId when menu_items have no restaurant_id (null)', async () => {
      const mockSupabase = createMockSupabase({
        data: [
          { id: 'item-1', restaurant_id: null },
          { id: 'item-2', restaurant_id: null },
        ],
        error: null,
      });

      const items = [
        { id: 'item-1', name: 'Biryani', quantity: 1 },
        { id: 'item-2', name: 'Noodles', quantity: 2 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('returns null restaurantId on database error (graceful degradation)', async () => {
      const mockSupabase = createMockSupabase({
        data: null,
        error: { message: 'Connection timeout' },
      });

      const items = [{ id: 'item-1', name: 'Biryani', quantity: 1 }];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('filters out items with null/undefined ids before querying', async () => {
      const mockSupabase = createMockSupabase({ data: [], error: null });

      const items = [
        { id: null, name: 'Unknown', quantity: 1 },
        { id: undefined, name: 'Also Unknown', quantity: 1 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      // With no valid IDs after filtering, should return null (early return)
      expect(result).toEqual({ restaurantId: null, error: null });
    });

    it('handles mixed items - some in menu_items, some not (partial match)', async () => {
      const restaurantUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockSupabase = createMockSupabase({
        data: [{ id: 'item-1', restaurant_id: restaurantUuid }],
        error: null,
      });

      const items = [
        { id: 'item-1', name: 'Biryani', quantity: 1 },
        { id: 301, name: 'Legacy item', quantity: 2 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: restaurantUuid, error: null });
    });

    it('deduplicates restaurant IDs when same restaurant appears multiple times', async () => {
      const restaurantUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockSupabase = createMockSupabase({
        data: [
          { id: 'item-1', restaurant_id: restaurantUuid },
          { id: 'item-2', restaurant_id: restaurantUuid },
          { id: 'item-3', restaurant_id: restaurantUuid },
        ],
        error: null,
      });

      const items = [
        { id: 'item-1', quantity: 1 },
        { id: 'item-2', quantity: 1 },
        { id: 'item-3', quantity: 1 },
      ];
      const result = await resolveRestaurantFromItems(items, { supabase: mockSupabase });

      expect(result).toEqual({ restaurantId: restaurantUuid, error: null });
    });
  });

  describe('resolveOrderStatusAndDeliveryType', () => {
    it('returns status "pending" and deliveryType "room" for room delivery', () => {
      const result = resolveOrderStatusAndDeliveryType('room');
      expect(result).toEqual({ status: 'pending', deliveryType: 'room' });
    });

    it('returns default status and deliveryType "normal" for normal delivery', () => {
      const result = resolveOrderStatusAndDeliveryType('normal');
      expect(result).toEqual({ status: 'placed', deliveryType: 'normal' });
    });

    it('uses custom default status for non-room delivery', () => {
      const result = resolveOrderStatusAndDeliveryType('normal', 'confirmed');
      expect(result).toEqual({ status: 'confirmed', deliveryType: 'normal' });
    });

    it('returns deliveryType "normal" for undefined delivery type', () => {
      const result = resolveOrderStatusAndDeliveryType(undefined);
      expect(result).toEqual({ status: 'placed', deliveryType: 'normal' });
    });

    it('returns deliveryType "normal" for null delivery type', () => {
      const result = resolveOrderStatusAndDeliveryType(null);
      expect(result).toEqual({ status: 'placed', deliveryType: 'normal' });
    });

    it('always returns status "pending" for room delivery regardless of defaultStatus', () => {
      const result = resolveOrderStatusAndDeliveryType('room', 'confirmed');
      expect(result).toEqual({ status: 'pending', deliveryType: 'room' });
    });
  });
});
