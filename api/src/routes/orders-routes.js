const express = require('express');
const multer = require('multer');
const workflow = require('../controllers/order-workflow-controller');
const { listOrders } = require('../controllers/orders-controller');
const { authorize } = require('../middleware/authz');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 } }).single('document');
function receiveDocument(req, res, next) {
  upload(req, res, error => {
    if (error) return res.status(400).json({ ok: false, message: 'Choose one PDF, PNG, or JPEG document up to 5 MB.' });
    next();
  });
}
function receiveOrder(req, res, next) {
  // Keep JSON clients working; multipart clients send the same order as JSON
  // in payload plus an optional document. Persist both in one transaction.
  if (!req.is('multipart/form-data')) return next();
  receiveDocument(req, res, () => {
    try {
      const payload = JSON.parse(req.body.payload);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
      req.body = payload;
    } catch {
      return res.status(400).json({ ok: false, message: 'The order details must be a valid JSON object.' });
    }
    next();
  });
}
router.get('/workflow-settings', authorize(['orders.read', 'orders.create']), workflow.getSettings);
router.put('/workflow-settings', authorize('orders.configure'), workflow.saveSettings);
router.post('/document-uploads', authorize(['orders.create', 'orders.update']), receiveDocument, workflow.stageDocument);
router.delete('/document-uploads/:uploadId', authorize(['orders.create', 'orders.update']), workflow.discardUpload);
router.post('/', authorize('orders.create'), receiveOrder, workflow.createOrder);
router.get('/', authorize('orders.read'), listOrders);
router.get('/:id', authorize('orders.read'), workflow.getOrder);
router.put('/:id', authorize('orders.update'), receiveOrder, workflow.updateOrder);
router.patch('/:id', authorize('orders.update'), receiveOrder, workflow.updateOrder);
router.delete('/:id', authorize('orders.update'), workflow.deleteOrder);
router.post('/:id/actions', authorize(), workflow.performAction);
router.post('/:id/documents', authorize('orders.update'), receiveDocument, workflow.uploadDocument);
router.get('/:id/documents/:documentId', authorize('orders.read'), workflow.downloadDocument);
module.exports = router;
