const express = require('express');
const { getMyProfile, updateMyProfile } = require('../controllers/profile-controller');
const { uploadProfileImage } = require('../middleware/upload');

const router = express.Router();

router.get('/', getMyProfile);
router.put('/', uploadProfileImage, updateMyProfile);
router.patch('/', uploadProfileImage, updateMyProfile);

module.exports = router;
