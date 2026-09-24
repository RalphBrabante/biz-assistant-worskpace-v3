const multer = require('multer');
const {MAX_ATTACHMENT_BYTES, MAX_FILES} = require('../services/ticket-conversation');
// A shared per-request byte budget avoids buffering 10 x 10 MB files.
const storage = {
  _handleFile(req, file, cb) {
    const chunks = []; let size = 0;
    file.stream.on('data', chunk => {
      size += chunk.length; req.ticketUploadBytes = (req.ticketUploadBytes || 0) + chunk.length;
      if (req.ticketUploadBytes > MAX_ATTACHMENT_BYTES) {
        file.stream.destroy(Object.assign(new Error('Attachments must total no more than 10 MB.'), {status: 413}));
      } else chunks.push(chunk);
    });
    file.stream.once('error', cb);
    file.stream.once('end', () => cb(null, {buffer: Buffer.concat(chunks), size}));
  },
  _removeFile(_req, file, cb) { delete file.buffer; cb(null); },
};
const upload = multer({storage, limits: {files: MAX_FILES, fileSize: MAX_ATTACHMENT_BYTES, fields: 5, fieldSize: 200000, parts: MAX_FILES + 6}}).array('attachments', MAX_FILES);
function uploadTicketAttachments(req, res, next) {
  upload(req, res, error => {
    if (error) return res.status(error.status || 400).json({message: error.status ? error.message : 'Attach up to 10 files, totaling no more than 10 MB, with a reply of up to 50,000 characters.'});
    next();
  });
}
module.exports = {uploadTicketAttachments};
