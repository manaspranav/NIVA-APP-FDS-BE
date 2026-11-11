/**
 * Delivery Partner Orders Router
 *
 * Mounted at /api/partner/orders
 * Provides a status transition endpoint for delivery partners,
 * enforcing the delivery partner state machine:
 *   ready_for_pickup → picked_up
 *   picked_up → out_for_delivery
 *   out_for_delivery → delivered
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5
 */
const express = require('express');
const { getSupabase } = require('../lib/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * PUT /:orderId/status
 * Requires partner role.
 * Advances an order's status through delivery partner allowed transitions.
 *
 * Allowed transitions:
 *   ready_for_pickup → picked_up
 *   picked_up → out_for_delivery
 *   out_for_delivery → delivered
 *
 * Rejects transitions to restaurant owner statuses (accepted, preparing, ready_for_pickup) with HTTP 403.
 * Rejects invalid transitions with HTTP 409 naming the disallowed transition.
 * On success: updates status and sets corresponding timestamp (picked_up_at, delivered_at).
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5
 */
router.put(
  '/:orderId/status',
  authenticateToken,
  requireRole('partner'),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status: targetStatus } = req.body;

      if (!targetStatus) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: 'Target status is required'
        });
      }

      const supabase = getSupabase();

      // Fetch the order by id
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('id, status, restaurant_id, delivery_type, picked_up_at, delivered_at')
        .eq('id', orderId)
        .single();

      if (fetchError || !order) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: 'Order not found'
        });
      }

      // Reject transitions to restaurant owner statuses
      const restaurantOwnerStatuses = ['accepted', 'preparing', 'ready_for_pickup'];
      if (restaurantOwnerStatuses.includes(targetStatus)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Cannot transition to restaurant owner statuses'
        });
      }

      // Define allowed transitions for delivery partner
      const allowedTransitions = {
        ready_for_pickup: ['picked_up'],
        picked_up: ['out_for_delivery'],
        out_for_delivery: ['delivered']
      };

      const currentStatus = order.status;
      const allowedTargets = allowedTransitions[currentStatus];

      // If current status is not in the map keys, or target is not in allowed list
      if (!allowedTargets || !allowedTargets.includes(targetStatus)) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: `Cannot transition from ${currentStatus} to ${targetStatus}`
        });
      }

      // Build update object
      const updateObj = { status: targetStatus };

      // Set timestamp based on target status
      const now = new Date().toISOString();
      if (targetStatus === 'picked_up') {
        updateObj.picked_up_at = now;
      } else if (targetStatus === 'delivered') {
        updateObj.delivered_at = now;
      }

      // Update the order
      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update(updateObj)
        .eq('id', orderId)
        .select('id, status, delivery_type, picked_up_at, delivered_at')
        .single();

      if (updateError) {
        console.error('[PartnerOrders] PUT /:orderId/status update error:', updateError.message);
        return res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update order status'
        });
      }

      return res.status(200).json({
        success: true,
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          delivery_type: updatedOrder.delivery_type,
          picked_up_at: updatedOrder.picked_up_at,
          delivered_at: updatedOrder.delivered_at
        }
      });
    } catch (err) {
      console.error('[PartnerOrders] PUT /:orderId/status unexpected error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to update order status'
      });
    }
  }
);

module.exports = router;
