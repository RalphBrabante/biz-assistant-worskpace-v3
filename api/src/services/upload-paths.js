const path = require('path');
function getUploadDirectory() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
}
module.exports = { getUploadDirectory };
