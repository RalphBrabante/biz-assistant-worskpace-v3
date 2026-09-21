const fs = require('fs');
const path = require('path');
const express = require('express');

function installFrontend(app, directory) {
  if (!directory) return;
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) throw new Error('CLIENT_DIST_DIR must contain a built index.html.');
  const assets = express.static(root, {
    index: false, redirect: false, dotfiles: 'ignore',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });
  app.use((req, res, next) => {
    if (/^\/(api|uploads|socket\.io|healthz)(\/|$)/i.test(req.path)) return next();
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    assets(req, res, (error) => {
      if (error) return next(error);
      if (req.path.split('/').some((part) => part.startsWith('.')) || path.extname(req.path) || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  });
}
module.exports = { installFrontend };
