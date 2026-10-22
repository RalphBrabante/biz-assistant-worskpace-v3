const fs = require('fs');
const path = require('path');
const express = require('express');

// Mirrors the nginx headers for deployments where Node serves the SPA directly (e.g. Hostinger).
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' wss:; frame-src 'self' blob:; worker-src 'self'; object-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function setSecurityHeaders(req, res) {
  res.set(SECURITY_HEADERS);
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function installFrontend(app, directory) {
  if (!directory) return;
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) throw new Error('CLIENT_DIST_DIR must contain a built index.html.');
  const assets = express.static(root, {
    index: false, redirect: false, dotfiles: 'ignore',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
      setSecurityHeaders(res.req, res);
    },
  });
  app.use((req, res, next) => {
    if (/^\/(api|uploads|socket\.io|healthz)(\/|$)/i.test(req.path)) return next();
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    assets(req, res, (error) => {
      if (error) return next(error);
      if (req.path.split('/').some((part) => part.startsWith('.')) || path.extname(req.path) || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      setSecurityHeaders(req, res);
      res.sendFile(index);
    });
  });
}
module.exports = { installFrontend };
