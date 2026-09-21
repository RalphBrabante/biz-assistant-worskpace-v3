const express = require('express');
const {
  createOrder,
  listOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
} = require('../controllers/orders-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('orders.create'), createOrder);
router.get('/', authorize('orders.read'), listOrders);
router.get('/:id', authorize('orders.read'), getOrderById);
router.put('/:id', authorize('orders.update'), updateOrder);
router.patch('/:id', authorize('orders.update'), updateOrder);
router.delete('/:id', authorize('orders.update'), deleteOrder);

module.exports = router;
