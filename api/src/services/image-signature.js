const IMAGE_SIGNATURES = [
  { ext: '.png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  { ext: '.gif', mime: 'image/gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { ext: '.webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// Identifies a raster image from its leading bytes; never from a filename or client Content-Type.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }
  return IMAGE_SIGNATURES.find((signature) => signature.test(buffer)) || null;
}

module.exports = { detectImageType };
