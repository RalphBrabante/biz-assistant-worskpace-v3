const express = require('express');
const {
  createItem,
  importItems,
  exportItems,
  listItems,
  getItemById,
  updateItem,
  deleteItem,
} = require('../controllers/items-controller');
const { authorize } = require('../middleware/authz');
const { uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.post('/', authorize('items.create'), createItem);
router.post('/import', authorize('items.create'), uploadImportCsv, importItems);
router.get('/export', authorize('items.read'), exportItems);
router.get('/', authorize('items.read'), listItems);
router.get('/:id', authorize('items.read'), getItemById);
router.put('/:id', authorize('items.update'), updateItem);
router.patch('/:id', authorize('items.update'), updateItem);
router.delete('/:id', authorize('items.delete'), deleteItem);

module.exports = router;
