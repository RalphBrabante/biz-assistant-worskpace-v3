const path = require('path');
const express = require('express');
const { getUploadDirectory } = require('../services/upload-paths');

const SERVABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// Financial attachments are only served through the authenticated, organization-scoped API
const PRIVATE_PREFIXES = ['/expenses/'];

// Public uploads (profile images) are served as inert images only: nothing uploaded can run script
// on the app origin, even files stored before upload content checks existed.
function createUploadsStatic() {
  const serveStatic = express.static(getUploadDirectory(), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });

  return (req, res, next) => {
    // serve-static decodes the path before reading the file, so the checks must see the decoded,
    // normalized path too (otherwise /%65xpenses/... would bypass the private-folder rule)
    let requestPath;
    try {
      requestPath = path.posix.normalize(decodeURIComponent(String(req.path || ''))).toLowerCase();
    } catch (_err) {
      return res.status(400).end();
    }
    if (PRIVATE_PREFIXES.some((prefix) => requestPath.startsWith(prefix))
      || !SERVABLE_EXTENSIONS.has(path.extname(requestPath))) {
      return res.status(404).end();
    }
    return serveStatic(req, res, next);
  };
}

module.exports = { createUploadsStatic };
