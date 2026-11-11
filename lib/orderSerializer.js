/**
 * Order Serializer — strips monetary fields from order and menu item payloads
 * for Restaurant Owner responses.
 *
 * Requirements: 5.2, 5.8, 7.2, 7.4, 7.6
 */

const MONETARY_FIELDS = [
  'total_amount',
  'subtotal',
  'platform_fee',
  'delivery_fee',
  'commission',
  'discount_value',
  'coupon_discount',
  'revenue',
  'price',
  'original_price',
  'item_total',
];

/**
 * Strips all monetary fields from an order object, including nested items.
 * Items may be a JSON string or an array — both are handled.
 *
 * @param {object|null|undefined} order - The order object to sanitize
 * @returns {object|null} Sanitized order without monetary fields, or null if input is nullish
 */
function sanitizeOrderForRestaurantOwner(order) {
  if (order == null) return null;

  const sanitized = { ...order };
  MONETARY_FIELDS.forEach((field) => delete sanitized[field]);

  if (sanitized.items != null) {
    let items;
    if (typeof sanitized.items === 'string') {
      try {
        items = JSON.parse(sanitized.items);
      } catch {
        // If items is a malformed JSON string, remove it rather than expose potential monetary data
        items = [];
      }
    } else if (Array.isArray(sanitized.items)) {
      items = sanitized.items;
    } else {
      items = [];
    }

    sanitized.items = items.map((item) => {
      if (item == null) return item;
      const cleanItem = { ...item };
      MONETARY_FIELDS.forEach((field) => delete cleanItem[field]);
      return cleanItem;
    });
  }

  return sanitized;
}

/**
 * Strips monetary fields (price, original_price, etc.) from a menu item object.
 *
 * @param {object|null|undefined} item - The menu item to sanitize
 * @returns {object|null} Sanitized menu item without monetary fields, or null if input is nullish
 */
function sanitizeMenuItemForRestaurantOwner(item) {
  if (item == null) return null;

  const sanitized = { ...item };
  MONETARY_FIELDS.forEach((field) => delete sanitized[field]);
  return sanitized;
}

module.exports = {
  MONETARY_FIELDS,
  sanitizeOrderForRestaurantOwner,
  sanitizeMenuItemForRestaurantOwner,
};
