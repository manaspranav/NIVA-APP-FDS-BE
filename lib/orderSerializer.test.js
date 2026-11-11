import { describe, it, expect } from 'vitest';
import {
  MONETARY_FIELDS,
  sanitizeOrderForRestaurantOwner,
  sanitizeMenuItemForRestaurantOwner,
} from './orderSerializer.js';

describe('orderSerializer', () => {
  describe('MONETARY_FIELDS', () => {
    it('contains all expected monetary field names', () => {
      expect(MONETARY_FIELDS).toContain('total_amount');
      expect(MONETARY_FIELDS).toContain('subtotal');
      expect(MONETARY_FIELDS).toContain('platform_fee');
      expect(MONETARY_FIELDS).toContain('delivery_fee');
      expect(MONETARY_FIELDS).toContain('commission');
      expect(MONETARY_FIELDS).toContain('discount_value');
      expect(MONETARY_FIELDS).toContain('coupon_discount');
      expect(MONETARY_FIELDS).toContain('revenue');
      expect(MONETARY_FIELDS).toContain('price');
      expect(MONETARY_FIELDS).toContain('original_price');
      expect(MONETARY_FIELDS).toContain('item_total');
      expect(MONETARY_FIELDS).toHaveLength(11);
    });
  });

  describe('sanitizeOrderForRestaurantOwner', () => {
    it('returns null for null input', () => {
      expect(sanitizeOrderForRestaurantOwner(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(sanitizeOrderForRestaurantOwner(undefined)).toBeNull();
    });

    it('strips all monetary fields from a flat order', () => {
      const order = {
        id: 'order-1',
        customer_name: 'Rahul',
        status: 'pending',
        total_amount: 500,
        subtotal: 450,
        platform_fee: 20,
        delivery_fee: 30,
        commission: 50,
        discount_value: 10,
        coupon_discount: 5,
        revenue: 400,
        price: 450,
        original_price: 500,
        item_total: 450,
      };

      const result = sanitizeOrderForRestaurantOwner(order);

      expect(result.id).toBe('order-1');
      expect(result.customer_name).toBe('Rahul');
      expect(result.status).toBe('pending');
      MONETARY_FIELDS.forEach((field) => {
        expect(result).not.toHaveProperty(field);
      });
    });

    it('does not mutate the original order object', () => {
      const order = { id: 'order-1', total_amount: 500, price: 100 };
      sanitizeOrderForRestaurantOwner(order);
      expect(order.total_amount).toBe(500);
      expect(order.price).toBe(100);
    });

    it('strips monetary fields from items when items is an array', () => {
      const order = {
        id: 'order-1',
        items: [
          { name: 'Biryani', quantity: 2, price: 149, original_price: 200, item_total: 298 },
          { name: 'Noodles', quantity: 1, price: 109, original_price: 120, item_total: 109 },
        ],
      };

      const result = sanitizeOrderForRestaurantOwner(order);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe('Biryani');
      expect(result.items[0].quantity).toBe(2);
      expect(result.items[0]).not.toHaveProperty('price');
      expect(result.items[0]).not.toHaveProperty('original_price');
      expect(result.items[0]).not.toHaveProperty('item_total');
      expect(result.items[1].name).toBe('Noodles');
      expect(result.items[1]).not.toHaveProperty('price');
    });

    it('strips monetary fields from items when items is a JSON string', () => {
      const itemsArray = [
        { name: 'Biryani', quantity: 2, price: 149, commission: 15 },
      ];
      const order = {
        id: 'order-1',
        items: JSON.stringify(itemsArray),
      };

      const result = sanitizeOrderForRestaurantOwner(order);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Biryani');
      expect(result.items[0].quantity).toBe(2);
      expect(result.items[0]).not.toHaveProperty('price');
      expect(result.items[0]).not.toHaveProperty('commission');
    });

    it('handles empty items array', () => {
      const order = { id: 'order-1', items: [] };
      const result = sanitizeOrderForRestaurantOwner(order);
      expect(result.items).toEqual([]);
    });

    it('handles malformed JSON string for items gracefully', () => {
      const order = { id: 'order-1', items: 'not-valid-json{' };
      const result = sanitizeOrderForRestaurantOwner(order);
      expect(result.items).toEqual([]);
    });

    it('handles items that is neither string nor array', () => {
      const order = { id: 'order-1', items: 12345 };
      const result = sanitizeOrderForRestaurantOwner(order);
      expect(result.items).toEqual([]);
    });

    it('preserves non-monetary fields', () => {
      const order = {
        id: 'order-1',
        customer_name: 'Rahul',
        hostel_room: 'A-204',
        order_notes: 'Extra spicy',
        status: 'pending',
        delivery_type: 'room',
        created_at: '2025-01-15T12:30:00Z',
      };

      const result = sanitizeOrderForRestaurantOwner(order);

      expect(result.id).toBe('order-1');
      expect(result.customer_name).toBe('Rahul');
      expect(result.hostel_room).toBe('A-204');
      expect(result.order_notes).toBe('Extra spicy');
      expect(result.status).toBe('pending');
      expect(result.delivery_type).toBe('room');
      expect(result.created_at).toBe('2025-01-15T12:30:00Z');
    });
  });

  describe('sanitizeMenuItemForRestaurantOwner', () => {
    it('returns null for null input', () => {
      expect(sanitizeMenuItemForRestaurantOwner(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(sanitizeMenuItemForRestaurantOwner(undefined)).toBeNull();
    });

    it('strips price and other monetary fields from a menu item', () => {
      const item = {
        id: 'item-1',
        name: 'Dum Biryani',
        category: 'Biryani',
        image: '/Biryani/DumBiryani.png',
        is_veg: false,
        in_stock: true,
        price: 149,
        original_price: 200,
      };

      const result = sanitizeMenuItemForRestaurantOwner(item);

      expect(result.id).toBe('item-1');
      expect(result.name).toBe('Dum Biryani');
      expect(result.category).toBe('Biryani');
      expect(result.is_veg).toBe(false);
      expect(result.in_stock).toBe(true);
      expect(result).not.toHaveProperty('price');
      expect(result).not.toHaveProperty('original_price');
    });

    it('does not mutate the original item object', () => {
      const item = { id: 'item-1', name: 'Biryani', price: 149 };
      sanitizeMenuItemForRestaurantOwner(item);
      expect(item.price).toBe(149);
    });

    it('preserves non-monetary fields', () => {
      const item = {
        id: 'item-1',
        name: 'Dum Biryani',
        category: 'Biryani',
        image: '/Biryani/DumBiryani.png',
        is_veg: false,
        in_stock: true,
        restaurant_id: 'rest-123',
      };

      const result = sanitizeMenuItemForRestaurantOwner(item);

      expect(result.id).toBe('item-1');
      expect(result.name).toBe('Dum Biryani');
      expect(result.category).toBe('Biryani');
      expect(result.image).toBe('/Biryani/DumBiryani.png');
      expect(result.is_veg).toBe(false);
      expect(result.in_stock).toBe(true);
      expect(result.restaurant_id).toBe('rest-123');
    });
  });
});
