const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { getUploadDirectory } = require('../services/upload-paths');
const { detectImageType } = require('../services/image-signature');
const expenseUploadDir = path.join(getUploadDirectory(), 'expenses');
const profileUploadDir = path.join(getUploadDirectory(), 'profiles');
fs.mkdirSync(expenseUploadDir, { recursive: true });
fs.mkdirSync(profileUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(expenseUploadDir, { recursive: true });
    cb(null, expenseUploadDir);
  },
  filename: (_req, _file, cb) => {
    cb(null, `expense-${crypto.randomBytes(16).toString('hex')}.upload`);
  },
});

function imageOnlyFilter(_req, file, cb) {
  if (!file || !file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
    cb(new Error('Only image files are allowed for expense file uploads.'));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: imageOnlyFilter,
});

// The client's filename and Content-Type are untrusted; derive both from the file's own bytes
// so nothing but a raster image can ever be stored and served from /uploads.
async function verifyStoredImage(file) {
  const handle = await fs.promises.open(file.path, 'r');
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const signature = detectImageType(header);
  if (!signature) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error('Only image files are allowed (PNG, JPEG, GIF or WebP).');
  }
  const verifiedPath = file.path.replace(/\.upload$/, signature.ext);
  await fs.promises.rename(file.path, verifiedPath);
  Object.assign(file, {
    path: verifiedPath,
    filename: path.basename(verifiedPath),
    mimetype: signature.mime,
    originalname: `${path.parse(String(file.originalname || 'image')).name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120)}${signature.ext}`,
  });
}

function verifiedImageUpload(multerMiddleware) {
  return (req, res, next) => multerMiddleware(req, res, (err) => {
    if (err || !req.file) {
      next(err);
      return;
    }
    verifyStoredImage(req.file).then(() => next(), next);
  });
}

const uploadExpenseImage = verifiedImageUpload(upload.single('file'));

const profileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(profileUploadDir, { recursive: true });
    cb(null, profileUploadDir);
  },
  filename: (_req, _file, cb) => {
    cb(null, `profile-${crypto.randomBytes(16).toString('hex')}.upload`);
  },
});

const profileUpload = multer({
  storage: profileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: imageOnlyFilter,
});

const uploadProfileImage = verifiedImageUpload(profileUpload.single('profileImage'));

function csvOnlyFilter(_req, file, cb) {
  const name = String(file?.originalname || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const isCsvName = name.endsWith('.csv');
  const isCsvMime =
    mime.includes('csv') ||
    mime === 'text/plain' ||
    mime === 'application/vnd.ms-excel';

  if (!isCsvName && !isCsvMime) {
    cb(new Error('Only CSV files are allowed for import.'));
    return;
  }
  cb(null, true);
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: csvOnlyFilter,
});

const uploadImportCsv = importUpload.single('file');

module.exports = {
  uploadExpenseImage,
  uploadProfileImage,
  uploadImportCsv,
};
