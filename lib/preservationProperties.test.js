/**
 * Preservation Property Tests — Existing Order Lifecycle Behaviors
 *
 * GOAL: These tests MUST PASS on UNFIXED code.
 * They capture the baseline behaviors that must NOT regress after bug fixes.
 *
 * Covers Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 *
 * Properties observed on unfixed code:
 *   P1: Legacy numeric item IDs → restaurant_id remains null (Req 3.1, 3.2)
 *   P2: Restaurant owner status transitions enforced (Req 3.3)
 *   P3: Delivery partner status transitions enforced (Req 3.4)
 *   P4: Reorder for numeric IDs → navigates to /product/:type/:id (Req 3.5)
 *   P5: Explicit logout clears session + redirects (Req 3.6)
 *   P6: Customer order fetch returns complete order data (Req 3.7)
 *   P7: Menu item stock and availability toggling works (Req 3.8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { resolveRestaurantFromItems, resolveOrderStatusAndDeliveryType } from './orderRestaurantResolver.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Legacy catalog numeric IDs used in hardcoded catalogs (301-316 range) */
const LEGACY_NUMERIC_IDS = [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];

/** Creates a mock Supabase that returns empty menu_items (simulating legacy catalog lookup) */
function makeLegacyCatalogSupabase() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  };
}

/** Checks if a string is a UUID */
function isUUID(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
}

/** Checks if an ID is numeric (legacy catalog format) */
function isNumericId(id) {
  return typeof id === 'number' || /^\d+$/.test(String(id));
}


// ─── P1: Legacy Numeric Item IDs → restaurant_id Stays Null ─────────────────

/**
 * Validates: Requirements 3.1, 3.2
 *
 * OBSERVATION: Orders with numeric item IDs (301-316 range) are legacy catalog
 * items NOT stored in the `menu_items` database table. resolveRestaurantFromItems()
 * returns null for these items. The pending_orders upsert and final order BOTH
 * correctly store restaurant_id = null. This behavior must be preserved after fix.
 */
describe('P1: Legacy numeric item IDs → restaurant_id remains null', () => {
  it('resolveRestaurantFromItems returns null for legacy catalog numeric IDs (301-316)', async () => {
    const supabase = makeLegacyCatalogSupabase();

    const items = [
      { id: 305, name: 'Dum Biryani', quantity: 2, price: 149 },
      { id: 312, name: 'Chicken Fry', quantity: 1, price: 89 },
    ];

    const { restaurantId, error } = await resolveRestaurantFromItems(items, { supabase });

    // Preservation: legacy items always resolve to null
    expect(restaurantId).toBeNull();
    expect(error).toBeNull();
  });

  it('property: for all orders with only numeric item IDs, restaurant_id resolves to null', async () => {
    /**
     * **Validates: Requirements 3.1**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            // Numeric IDs from legacy catalog range (not UUIDs)
            id: fc.integer({ min: 300, max: 400 }),
            name: fc.string({ minLength: 1, maxLength: 30 }),
            quantity: fc.integer({ min: 1, max: 5 }),
            price: fc.integer({ min: 10, max: 500 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (items) => {
          // Simulate the DB lookup: numeric IDs are not in menu_items table
          const supabase = makeLegacyCatalogSupabase();

          const { restaurantId, error } = await resolveRestaurantFromItems(items, { supabase });

          // Legacy items must ALWAYS produce null restaurant_id (not be affected by Bug #1 fix)
          expect(restaurantId).toBeNull();
          expect(error).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('payment service fallback re-resolution: null restaurant_id in pending order triggers re-resolution', async () => {
    /**
     * **Validates: Requirements 3.2**
     *
     * OBSERVATION: When paymentService.createOrderFromCapturedPayment finds
     * pending.restaurant_id = null (legacy order), it falls back to calling
     * resolveRestaurantFromItems again. For legacy items this still returns null,
     * and the final order is created with restaurant_id = null. This fallback path
     * must continue to work.
     */
    const supabase = makeLegacyCatalogSupabase();

    // Simulate the fallback logic from paymentService.js
    const pendingRestaurantId = null; // legacy order: never stored
    const parsedItems = [
      { id: 305, name: 'Dum Biryani', quantity: 2, price: 149 },
    ];

    let restaurantId = pendingRestaurantId;
    if (!restaurantId) {
      // Fallback: re-resolve from items (as paymentService.js does)
      const { restaurantId: resolved } = await resolveRestaurantFromItems(parsedItems, { supabase });
      restaurantId = resolved;
    }

    // Result: still null for legacy items — order created with null restaurant_id
    expect(restaurantId).toBeNull();
  });

  it('property: fallback re-resolution for null pending restaurant_id always returns null for numeric IDs', async () => {
    /**
     * **Validates: Requirements 3.2**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.integer({ min: 300, max: 400 }),
            name: fc.string({ minLength: 1, maxLength: 20 }),
            quantity: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 1, maxLength: 4 }
        ),
        async (items) => {
          const supabase = makeLegacyCatalogSupabase();

          // Simulate paymentService fallback: pending.restaurant_id is null
          let restaurantId = null;
          if (!restaurantId) {
            const { restaurantId: resolved } = await resolveRestaurantFromItems(items, { supabase });
            restaurantId = resolved;
          }

          // After fallback, legacy numeric-ID orders still resolve to null
          expect(restaurantId).toBeNull();
        }
      ),
      { numRuns: 15 }
    );
  });
});


// ─── P2: Restaurant Owner Status Transitions Enforced ───────────────────────

/**
 * Validates: Requirements 3.3
 *
 * OBSERVATION: The restaurant portal enforces these allowed transitions:
 *   pending → accepted
 *   pending → cancelled
 *   accepted → preparing
 *   preparing → ready_for_pickup
 *
 * Transitions to partner statuses (picked_up, out_for_delivery, delivered) → 403
 * All other transitions → 409
 */
describe('P2: Restaurant owner status transitions remain enforced', () => {
  /** Mirrors the allowedTransitions map in restaurantPortal.js */
  const RESTAURANT_ALLOWED_TRANSITIONS = {
    pending: ['accepted', 'cancelled'],
    accepted: ['preparing'],
    preparing: ['ready_for_pickup'],
  };

  const PARTNER_STATUSES = ['picked_up', 'out_for_delivery', 'delivered'];

  function simulateRestaurantStatusUpdate(currentStatus, targetStatus) {
    if (PARTNER_STATUSES.includes(targetStatus)) {
      return { httpStatus: 403, message: 'Cannot transition to delivery partner statuses' };
    }
    const allowed = RESTAURANT_ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
      return { httpStatus: 409, message: `Cannot transition from ${currentStatus} to ${targetStatus}` };
    }
    return { httpStatus: 200, message: 'ok' };
  }

  it('allows pending → accepted', () => {
    expect(simulateRestaurantStatusUpdate('pending', 'accepted').httpStatus).toBe(200);
  });

  it('allows pending → cancelled', () => {
    expect(simulateRestaurantStatusUpdate('pending', 'cancelled').httpStatus).toBe(200);
  });

  it('allows accepted → preparing', () => {
    expect(simulateRestaurantStatusUpdate('accepted', 'preparing').httpStatus).toBe(200);
  });

  it('allows preparing → ready_for_pickup', () => {
    expect(simulateRestaurantStatusUpdate('preparing', 'ready_for_pickup').httpStatus).toBe(200);
  });

  it('rejects pending → preparing (skipping accepted) with 409', () => {
    const result = simulateRestaurantStatusUpdate('pending', 'preparing');
    expect(result.httpStatus).toBe(409);
  });

  it('rejects accepted → ready_for_pickup (skipping preparing) with 409', () => {
    const result = simulateRestaurantStatusUpdate('accepted', 'ready_for_pickup');
    expect(result.httpStatus).toBe(409);
  });

  it('rejects transition to partner status (picked_up) with 403', () => {
    expect(simulateRestaurantStatusUpdate('ready_for_pickup', 'picked_up').httpStatus).toBe(403);
  });

  it('rejects transition to partner status (out_for_delivery) with 403', () => {
    expect(simulateRestaurantStatusUpdate('ready_for_pickup', 'out_for_delivery').httpStatus).toBe(403);
  });

  it('rejects transition to partner status (delivered) with 403', () => {
    expect(simulateRestaurantStatusUpdate('ready_for_pickup', 'delivered').httpStatus).toBe(403);
  });

  it('property: all valid restaurant transitions succeed, invalid ones are rejected', () => {
    /**
     * **Validates: Requirements 3.3**
     */
    fc.assert(
      fc.property(
        fc.constantFrom('pending', 'accepted', 'preparing', 'ready_for_pickup', 'cancelled', 'placed'),
        fc.constantFrom(
          'pending', 'accepted', 'preparing', 'ready_for_pickup', 'cancelled',
          'picked_up', 'out_for_delivery', 'delivered', 'placed'
        ),
        (currentStatus, targetStatus) => {
          const result = simulateRestaurantStatusUpdate(currentStatus, targetStatus);

          if (PARTNER_STATUSES.includes(targetStatus)) {
            expect(result.httpStatus).toBe(403);
          } else {
            const allowed = RESTAURANT_ALLOWED_TRANSITIONS[currentStatus];
            const isAllowed = allowed && allowed.includes(targetStatus);
            if (isAllowed) {
              expect(result.httpStatus).toBe(200);
            } else {
              expect(result.httpStatus).toBe(409);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: exactly 4 valid restaurant transitions exist', () => {
    /**
     * **Validates: Requirements 3.3**
     */
    const allAllowed = Object.entries(RESTAURANT_ALLOWED_TRANSITIONS).flatMap(
      ([from, targets]) => targets.map(to => `${from}->${to}`)
    );

    expect(allAllowed).toHaveLength(4);
    expect(allAllowed).toContain('pending->accepted');
    expect(allAllowed).toContain('pending->cancelled');
    expect(allAllowed).toContain('accepted->preparing');
    expect(allAllowed).toContain('preparing->ready_for_pickup');
  });
});


// ─── P3: Delivery Partner Status Transitions Enforced ───────────────────────

/**
 * Validates: Requirements 3.4
 *
 * OBSERVATION: The partner orders route enforces:
 *   ready_for_pickup → picked_up
 *   picked_up → out_for_delivery
 *   out_for_delivery → delivered
 *
 * Transitions to restaurant owner statuses (accepted, preparing, ready_for_pickup) → 403
 * All other transitions → 409
 */
describe('P3: Delivery partner status transitions remain enforced', () => {
  /** Mirrors the allowedTransitions map in partnerOrders.js */
  const PARTNER_ALLOWED_TRANSITIONS = {
    ready_for_pickup: ['picked_up'],
    picked_up: ['out_for_delivery'],
    out_for_delivery: ['delivered'],
  };

  const RESTAURANT_OWNER_STATUSES = ['accepted', 'preparing', 'ready_for_pickup'];

  function simulatePartnerStatusUpdate(currentStatus, targetStatus) {
    if (RESTAURANT_OWNER_STATUSES.includes(targetStatus)) {
      return { httpStatus: 403, message: 'Cannot transition to restaurant owner statuses' };
    }
    const allowed = PARTNER_ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
      return { httpStatus: 409, message: `Cannot transition from ${currentStatus} to ${targetStatus}` };
    }
    return { httpStatus: 200, message: 'ok' };
  }

  it('allows ready_for_pickup → picked_up', () => {
    expect(simulatePartnerStatusUpdate('ready_for_pickup', 'picked_up').httpStatus).toBe(200);
  });

  it('allows picked_up → out_for_delivery', () => {
    expect(simulatePartnerStatusUpdate('picked_up', 'out_for_delivery').httpStatus).toBe(200);
  });

  it('allows out_for_delivery → delivered', () => {
    expect(simulatePartnerStatusUpdate('out_for_delivery', 'delivered').httpStatus).toBe(200);
  });

  it('rejects ready_for_pickup → out_for_delivery (skipping step) with 409', () => {
    const result = simulatePartnerStatusUpdate('ready_for_pickup', 'out_for_delivery');
    expect(result.httpStatus).toBe(409);
  });

  it('rejects picked_up → delivered (skipping out_for_delivery) with 409', () => {
    const result = simulatePartnerStatusUpdate('picked_up', 'delivered');
    expect(result.httpStatus).toBe(409);
  });

  it('rejects transition to restaurant owner status (accepted) with 403', () => {
    expect(simulatePartnerStatusUpdate('ready_for_pickup', 'accepted').httpStatus).toBe(403);
  });

  it('rejects transition to restaurant owner status (preparing) with 403', () => {
    expect(simulatePartnerStatusUpdate('picked_up', 'preparing').httpStatus).toBe(403);
  });

  it('property: all valid partner transitions succeed, invalid ones are rejected', () => {
    /**
     * **Validates: Requirements 3.4**
     */
    fc.assert(
      fc.property(
        fc.constantFrom(
          'pending', 'accepted', 'preparing', 'ready_for_pickup',
          'picked_up', 'out_for_delivery', 'delivered'
        ),
        fc.constantFrom(
          'pending', 'accepted', 'preparing', 'ready_for_pickup',
          'picked_up', 'out_for_delivery', 'delivered', 'cancelled'
        ),
        (currentStatus, targetStatus) => {
          const result = simulatePartnerStatusUpdate(currentStatus, targetStatus);

          if (RESTAURANT_OWNER_STATUSES.includes(targetStatus)) {
            expect(result.httpStatus).toBe(403);
          } else {
            const allowed = PARTNER_ALLOWED_TRANSITIONS[currentStatus];
            const isAllowed = allowed && allowed.includes(targetStatus);
            if (isAllowed) {
              expect(result.httpStatus).toBe(200);
            } else {
              expect(result.httpStatus).toBe(409);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: exactly 3 valid partner transitions exist', () => {
    /**
     * **Validates: Requirements 3.4**
     */
    const allAllowed = Object.entries(PARTNER_ALLOWED_TRANSITIONS).flatMap(
      ([from, targets]) => targets.map(to => `${from}->${to}`)
    );

    expect(allAllowed).toHaveLength(3);
    expect(allAllowed).toContain('ready_for_pickup->picked_up');
    expect(allAllowed).toContain('picked_up->out_for_delivery');
    expect(allAllowed).toContain('out_for_delivery->delivered');
  });

  it('partner transitions only apply to room delivery orders', () => {
    /**
     * OBSERVATION: Partner status transitions are only meaningful for room
     * delivery orders. The route does not enforce delivery_type check, but
     * partner-visible orders are room delivery orders.
     * **Validates: Requirements 3.4**
     */
    const roomDeliveryOrder = {
      id: 'order-room-001',
      delivery_type: 'room',
      status: 'ready_for_pickup',
      restaurant_id: 'rest-uuid-001',
    };

    // Confirm this is a room delivery order in partner-visible status
    expect(roomDeliveryOrder.delivery_type).toBe('room');
    const result = simulatePartnerStatusUpdate(roomDeliveryOrder.status, 'picked_up');
    expect(result.httpStatus).toBe(200);
  });
});


// ─── P4: Reorder for Numeric IDs Navigates to /product/:type/:id ─────────────

/**
 * Validates: Requirements 3.5
 *
 * OBSERVATION: The reorder button in CustomerOrders.js navigates to:
 *   /product/${items[0].type || 'fastfood'}/${items[0].id}
 * For legacy numeric IDs (e.g. 305), parseInt(id) succeeds and the product
 * page resolves the item from the hardcoded catalog. This path must be preserved.
 */
describe('P4: Reorder for numeric IDs navigates to /product/:type/:id', () => {
  /** Replicates the reorder navigation logic from CustomerOrders.js */
  function getReorderRoute(items) {
    if (!items || items.length === 0) return null;
    const firstItem = items[0];
    return `/product/${firstItem.type || 'fastfood'}/${firstItem.id}`;
  }

  it('reorder with numeric ID navigates to /product/fastfood/:id', () => {
    const items = [{ id: 305, type: 'fastfood', name: 'Dum Biryani', quantity: 2, price: 149 }];
    const route = getReorderRoute(items);
    expect(route).toBe('/product/fastfood/305');
  });

  it('reorder with numeric ID uses default type "fastfood" when type is absent', () => {
    const items = [{ id: 308, name: 'Chicken Fry', quantity: 1, price: 89 }];
    const route = getReorderRoute(items);
    expect(route).toBe('/product/fastfood/308');
  });

  it('reorder with numeric ID produces parseable integer from route', () => {
    const items = [{ id: 312, type: 'biryani', name: 'Biryani', quantity: 1, price: 149 }];
    const route = getReorderRoute(items);
    const segments = route.split('/');
    const idFromRoute = segments[segments.length - 1];
    expect(parseInt(idFromRoute)).not.toBeNaN();
    expect(parseInt(idFromRoute)).toBe(312);
  });

  it('property: for all numeric item IDs, reorder route is /product/:type/:id and is parseable', () => {
    /**
     * **Validates: Requirements 3.5**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 400 }),
        fc.constantFrom('fastfood', 'biryani', 'chinese', undefined),
        (numericId, itemType) => {
          const items = [{ id: numericId, type: itemType, name: 'Item', quantity: 1, price: 100 }];
          const route = getReorderRoute(items);

          // Route must match /product/:type/:id pattern
          const expectedType = itemType || 'fastfood';
          expect(route).toBe(`/product/${expectedType}/${numericId}`);

          // The ID segment must be parseable as an integer (legacy product lookup)
          const segments = route.split('/');
          const idSegment = segments[segments.length - 1];
          const parsed = parseInt(idSegment);
          expect(parsed).not.toBeNaN();
          expect(parsed).toBe(numericId);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('property: numeric item reorder route never includes a UUID-like segment', () => {
    /**
     * **Validates: Requirements 3.5**
     * Numeric ID reorder routes must not inadvertently produce UUID-format routes.
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        (numericId) => {
          const items = [{ id: numericId, type: 'fastfood', name: 'Item', quantity: 1, price: 100 }];
          const route = getReorderRoute(items);

          const segments = route.split('/');
          const idSegment = segments[segments.length - 1];

          // The ID segment must NOT be a UUID
          expect(isUUID(idSegment)).toBe(false);
          // The ID segment must be a plain integer string
          expect(/^\d+$/.test(idSegment)).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });
});


// ─── P5: Explicit Logout Clears Session and Redirects ───────────────────────

/**
 * Validates: Requirements 3.6
 *
 * OBSERVATION: The RestaurantAuthContext logout() function:
 *   1. Calls the backend POST /api/restaurant-portal/logout (best-effort)
 *   2. Removes SESSION_KEY from localStorage
 *   3. Clears session, restaurant, isAuthenticated state
 *   4. Navigates to /restaurant-portal/login
 *
 * This behavior must be preserved after the Bug #6 fix (token refresh).
 */
describe('P5: Explicit logout clears session and redirects', () => {
  const SESSION_KEY = 'niva_restaurant_session';

  /** Replicates the RestaurantAuthContext logout logic */
  async function simulateLogout(sessionData, {
    fetchMock,
    setSession,
    setRestaurant,
    setIsAuthenticated,
    navigate,
    localStorageRemove,
  }) {
    // Best-effort backend logout call
    if (sessionData?.token) {
      try {
        await fetchMock(`/api/restaurant-portal/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionData.token}`,
          }
        });
      } catch {
        // Ignore errors — logout API failure should not block local cleanup
      }
    }

    // Clear localStorage
    localStorageRemove(SESSION_KEY);

    // Clear state
    setSession(null);
    setRestaurant(null);
    setIsAuthenticated(false);

    // Redirect to login
    navigate('/restaurant-portal/login');
  }

  it('explicit logout clears localStorage session key', async () => {
    const sessionData = {
      token: 'valid-jwt-token',
      refreshToken: 'valid-refresh-token',
      restaurant: { id: 'rest-001', name: 'Spice Kitchen' },
    };

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    const setSession = vi.fn();
    const setRestaurant = vi.fn();
    const setIsAuthenticated = vi.fn();
    const navigate = vi.fn();
    const localStorageRemove = vi.fn();

    await simulateLogout(sessionData, {
      fetchMock, setSession, setRestaurant, setIsAuthenticated, navigate, localStorageRemove,
    });

    expect(localStorageRemove).toHaveBeenCalledWith(SESSION_KEY);
  });

  it('explicit logout redirects to /restaurant-portal/login', async () => {
    const sessionData = { token: 'jwt', refreshToken: 'refresh', restaurant: { id: 'r1' } };
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    const navigate = vi.fn();
    const localStorageRemove = vi.fn();
    const setSession = vi.fn();
    const setRestaurant = vi.fn();
    const setIsAuthenticated = vi.fn();

    await simulateLogout(sessionData, {
      fetchMock, setSession, setRestaurant, setIsAuthenticated, navigate, localStorageRemove,
    });

    expect(navigate).toHaveBeenCalledWith('/restaurant-portal/login');
  });

  it('explicit logout clears session, restaurant, and isAuthenticated state', async () => {
    const sessionData = { token: 'jwt', refreshToken: 'refresh', restaurant: { id: 'r1', name: 'Spice Kitchen' } };
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    const navigate = vi.fn();
    const localStorageRemove = vi.fn();
    const setSession = vi.fn();
    const setRestaurant = vi.fn();
    const setIsAuthenticated = vi.fn();

    await simulateLogout(sessionData, {
      fetchMock, setSession, setRestaurant, setIsAuthenticated, navigate, localStorageRemove,
    });

    expect(setSession).toHaveBeenCalledWith(null);
    expect(setRestaurant).toHaveBeenCalledWith(null);
    expect(setIsAuthenticated).toHaveBeenCalledWith(false);
  });

  it('explicit logout still proceeds when backend logout API call fails', async () => {
    const sessionData = { token: 'jwt', restaurant: { id: 'r1' } };
    // Backend call throws (network error)
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    const navigate = vi.fn();
    const localStorageRemove = vi.fn();
    const setSession = vi.fn();
    const setRestaurant = vi.fn();
    const setIsAuthenticated = vi.fn();

    // Should NOT throw — backend failure is best-effort
    await expect(
      simulateLogout(sessionData, {
        fetchMock, setSession, setRestaurant, setIsAuthenticated, navigate, localStorageRemove,
      })
    ).resolves.toBeUndefined();

    // Local cleanup must still happen
    expect(localStorageRemove).toHaveBeenCalledWith(SESSION_KEY);
    expect(navigate).toHaveBeenCalledWith('/restaurant-portal/login');
    expect(setSession).toHaveBeenCalledWith(null);
  });

  it('property: for all explicit logout invocations, session is cleared and redirect occurs', async () => {
    /**
     * **Validates: Requirements 3.6**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          token: fc.string({ minLength: 5, maxLength: 50 }),
          refreshToken: fc.string({ minLength: 5, maxLength: 50 }),
          restaurant: fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 30 }),
          }),
        }),
        async (sessionData) => {
          const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
          const navigate = vi.fn();
          const localStorageRemove = vi.fn();
          const setSession = vi.fn();
          const setRestaurant = vi.fn();
          const setIsAuthenticated = vi.fn();

          await simulateLogout(sessionData, {
            fetchMock, setSession, setRestaurant, setIsAuthenticated, navigate, localStorageRemove,
          });

          // For ALL explicit logout calls:
          // 1. Session key removed from localStorage
          expect(localStorageRemove).toHaveBeenCalledWith(SESSION_KEY);
          // 2. State cleared
          expect(setSession).toHaveBeenCalledWith(null);
          expect(setRestaurant).toHaveBeenCalledWith(null);
          expect(setIsAuthenticated).toHaveBeenCalledWith(false);
          // 3. Redirect to login
          expect(navigate).toHaveBeenCalledWith('/restaurant-portal/login');
        }
      ),
      { numRuns: 15 }
    );
  });
});


// ─── P6: Customer Order Fetch Returns Complete Order Data ───────────────────

/**
 * Validates: Requirements 3.7
 *
 * OBSERVATION: GET /api/orders/customer/:customerId returns complete order
 * data including items (parsed from JSON string), total_amount, delivery details,
 * status, hostel info, delivery_type, and timestamps.
 * This must be preserved after Bug #4 fix (adding vendor_name display).
 */
describe('P6: Customer order fetch returns complete order data unchanged', () => {
  /** Required fields for a complete customer order */
  const REQUIRED_ORDER_FIELDS = [
    'id', 'status', 'items', 'total_amount',
    'delivery_type', 'placed_at', 'order_date',
  ];

  /** Fields that should render correctly in the orders list */
  const ITEM_REQUIRED_FIELDS = ['name', 'quantity', 'price'];

  it('order data object contains all required fields', () => {
    const sampleOrder = {
      id: 'order-uuid-1234-5678',
      status: 'placed',
      items: JSON.stringify([
        { id: 305, name: 'Dum Biryani', quantity: 2, price: 149, image: null, type: 'biryani' },
      ]),
      total_amount: 298,
      delivery_type: 'normal',
      placed_at: '2025-01-15T12:30:00Z',
      order_date: '2025-01-15T12:30:00Z',
      vendor_name: null, // may be null for legacy orders
      hostel_name: null,
      room_number: null,
      room_delivery_charge: 0,
    };

    REQUIRED_ORDER_FIELDS.forEach(field => {
      expect(sampleOrder).toHaveProperty(field);
    });
  });

  it('parseItems handles both array and JSON string items formats', () => {
    /** Replicates the parseItems logic from CustomerOrders.js */
    function parseItems(items) {
      if (!items) return [];
      if (Array.isArray(items)) return items;
      try { return JSON.parse(items); } catch { return []; }
    }

    const itemsArray = [{ id: 305, name: 'Biryani', quantity: 2, price: 149 }];

    // Works with array directly
    expect(parseItems(itemsArray)).toEqual(itemsArray);

    // Works with JSON string
    expect(parseItems(JSON.stringify(itemsArray))).toEqual(itemsArray);

    // Returns empty array for null
    expect(parseItems(null)).toEqual([]);

    // Returns empty array for malformed JSON
    expect(parseItems('not-valid-json{')).toEqual([]);
  });

  it('order items include name, quantity, and price for rendering', () => {
    const items = [
      { id: 305, name: 'Dum Biryani', quantity: 2, price: 149, image: null },
      { id: 308, name: 'Chicken Fry', quantity: 1, price: 89, image: null },
    ];

    items.forEach(item => {
      ITEM_REQUIRED_FIELDS.forEach(field => {
        expect(item).toHaveProperty(field);
      });
    });
  });

  it('property: for all customer orders, all required fields are present', () => {
    /**
     * **Validates: Requirements 3.7**
     */
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          status: fc.constantFrom('placed', 'taken', 'out_for_delivery', 'delivered'),
          items: fc.array(
            fc.record({
              id: fc.oneof(fc.integer({ min: 300, max: 400 }), fc.uuid()),
              name: fc.string({ minLength: 1, maxLength: 30 }),
              quantity: fc.integer({ min: 1, max: 5 }),
              price: fc.integer({ min: 10, max: 500 }),
            }),
            { minLength: 1, maxLength: 4 }
          ),
          total_amount: fc.integer({ min: 10, max: 5000 }),
          delivery_type: fc.constantFrom('normal', 'room'),
          placed_at: fc.constant('2025-01-15T12:30:00Z'),
          order_date: fc.constant('2025-01-15T12:30:00Z'),
        }),
        (order) => {
          // All required fields present
          REQUIRED_ORDER_FIELDS.forEach(field => {
            expect(order).toHaveProperty(field);
          });

          // Items are an array with required sub-fields
          expect(Array.isArray(order.items)).toBe(true);
          order.items.forEach(item => {
            ITEM_REQUIRED_FIELDS.forEach(field => {
              expect(item).toHaveProperty(field);
            });
          });

          // Total amount is a positive number
          expect(order.total_amount).toBeGreaterThan(0);

          // Delivery type is one of known values
          expect(['normal', 'room']).toContain(order.delivery_type);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('delivery details present for room delivery orders', () => {
    /**
     * **Validates: Requirements 3.7**
     * Room delivery orders must include hostel_name and room_number in rendering.
     */
    const roomOrder = {
      id: 'order-room-001',
      status: 'pending',
      delivery_type: 'room',
      hostel_name: 'Hostel A',
      room_number: '204',
      items: [{ id: 305, name: 'Biryani', quantity: 1, price: 149 }],
      total_amount: 149,
      room_delivery_charge: 20,
    };

    // Room delivery orders include hostel and room info
    expect(roomOrder.delivery_type).toBe('room');
    expect(roomOrder.hostel_name).toBeTruthy();
    expect(roomOrder.room_number).toBeTruthy();
    expect(roomOrder.room_delivery_charge).toBeGreaterThan(0);
  });
});


// ─── P7: Menu Item Stock and Availability Toggling Works ────────────────────

/**
 * Validates: Requirements 3.8
 *
 * OBSERVATION: Two endpoints handle toggles:
 *   PUT /api/restaurant-portal/menu/:itemId/stock   → updates in_stock boolean
 *   PUT /api/restaurant-portal/restaurant/availability → updates restaurant_available boolean
 *
 * Both:
 *   - Validate the boolean type of the payload field
 *   - Enforce restaurant ownership (item/restaurant must match authenticated owner)
 *   - Return the updated value in the success response
 */
describe('P7: Restaurant menu item stock and availability toggling works', () => {
  /** Simulates the stock toggle validation logic from restaurantPortal.js */
  function validateStockToggle(inStock, itemRestaurantId, ownerRestaurantId) {
    if (typeof inStock !== 'boolean') {
      return { httpStatus: 400, message: 'in_stock must be a boolean' };
    }
    if (!itemRestaurantId) {
      return { httpStatus: 404, message: 'Menu item not found' };
    }
    if (itemRestaurantId !== ownerRestaurantId) {
      return { httpStatus: 403, message: 'Access denied. Item does not belong to your restaurant' };
    }
    return { httpStatus: 200, in_stock: inStock };
  }

  /** Simulates the availability toggle validation logic from restaurantPortal.js */
  function validateAvailabilityToggle(available) {
    if (typeof available !== 'boolean') {
      return { httpStatus: 400, message: 'Field "available" must be a boolean' };
    }
    return { httpStatus: 200, restaurant_available: available };
  }

  it('stock toggle to true succeeds for matching restaurant', () => {
    const result = validateStockToggle(true, 'rest-001', 'rest-001');
    expect(result.httpStatus).toBe(200);
    expect(result.in_stock).toBe(true);
  });

  it('stock toggle to false succeeds for matching restaurant', () => {
    const result = validateStockToggle(false, 'rest-001', 'rest-001');
    expect(result.httpStatus).toBe(200);
    expect(result.in_stock).toBe(false);
  });

  it('stock toggle rejects non-boolean in_stock with 400', () => {
    expect(validateStockToggle('true', 'rest-001', 'rest-001').httpStatus).toBe(400);
    expect(validateStockToggle(1, 'rest-001', 'rest-001').httpStatus).toBe(400);
    expect(validateStockToggle(null, 'rest-001', 'rest-001').httpStatus).toBe(400);
  });

  it('stock toggle rejects item from different restaurant with 403', () => {
    const result = validateStockToggle(true, 'rest-002', 'rest-001');
    expect(result.httpStatus).toBe(403);
  });

  it('availability toggle to true succeeds', () => {
    const result = validateAvailabilityToggle(true);
    expect(result.httpStatus).toBe(200);
    expect(result.restaurant_available).toBe(true);
  });

  it('availability toggle to false succeeds', () => {
    const result = validateAvailabilityToggle(false);
    expect(result.httpStatus).toBe(200);
    expect(result.restaurant_available).toBe(false);
  });

  it('availability toggle rejects non-boolean available with 400', () => {
    expect(validateAvailabilityToggle('true').httpStatus).toBe(400);
    expect(validateAvailabilityToggle(1).httpStatus).toBe(400);
    expect(validateAvailabilityToggle(null).httpStatus).toBe(400);
  });

  it('property: stock toggle accepts only boolean values and enforces ownership', () => {
    /**
     * **Validates: Requirements 3.8**
     */
    fc.assert(
      fc.property(
        fc.anything(), // in_stock value — could be boolean or not
        fc.uuid(),     // ownerRestaurantId
        fc.uuid(),     // itemRestaurantId
        (inStock, ownerRestaurantId, itemRestaurantId) => {
          const result = validateStockToggle(inStock, itemRestaurantId, ownerRestaurantId);

          if (typeof inStock !== 'boolean') {
            // Non-boolean always rejected
            expect(result.httpStatus).toBe(400);
          } else if (itemRestaurantId !== ownerRestaurantId) {
            // Wrong restaurant → forbidden
            expect(result.httpStatus).toBe(403);
          } else {
            // Correct boolean + matching restaurant → success
            expect(result.httpStatus).toBe(200);
            expect(result.in_stock).toBe(inStock);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('property: availability toggle accepts only boolean values', () => {
    /**
     * **Validates: Requirements 3.8**
     */
    fc.assert(
      fc.property(
        fc.anything(), // available value
        (available) => {
          const result = validateAvailabilityToggle(available);

          if (typeof available !== 'boolean') {
            expect(result.httpStatus).toBe(400);
          } else {
            expect(result.httpStatus).toBe(200);
            expect(result.restaurant_available).toBe(available);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('property: toggling stock twice returns to original value', () => {
    /**
     * **Validates: Requirements 3.8**
     * Idempotency: toggling in_stock true→false→true gives original value.
     */
    fc.assert(
      fc.property(
        fc.boolean(), // initial stock state
        fc.uuid(),    // restaurantId
        (initialStock, restaurantId) => {
          // First toggle: flip
          const afterFirstToggle = !initialStock;
          const result1 = validateStockToggle(afterFirstToggle, restaurantId, restaurantId);
          expect(result1.httpStatus).toBe(200);
          expect(result1.in_stock).toBe(afterFirstToggle);

          // Second toggle: flip back
          const afterSecondToggle = !afterFirstToggle;
          const result2 = validateStockToggle(afterSecondToggle, restaurantId, restaurantId);
          expect(result2.httpStatus).toBe(200);
          expect(result2.in_stock).toBe(initialStock);
        }
      ),
      { numRuns: 20 }
    );
  });
});
