const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {uploadTicketAttachments} = require('../src/middleware/ticket-attachments');

test('multipart attachment uploads preserve bytes and reject combined size or count overflow', async t => {
  const app = express();
  let accepted = 0;
  app.post('/upload', uploadTicketAttachments, (req, res) => {accepted++; res.json({body: req.body.body, files: req.files.map(file => ({name: file.originalname, size: file.size, first: file.buffer[0]}))});});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const send = form => fetch(`http://127.0.0.1:${server.address().port}/upload`, {method: 'POST', body: form});
  const valid = new FormData(); valid.append('body', 'Hello'); valid.append('attachments', new Blob([Buffer.from([255, 1, 0])]), 'test.bin');
  const response = await send(valid); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {body: 'Hello', files: [{name: 'test.bin', size: 3, first: 255}]});
  const maximum = new FormData();
  for (const name of ['body', 'requestKey', 'version', 'mode', 'replyToMessageId']) maximum.append(name, 'value');
  for (let i = 0; i < 10; i++) maximum.append('attachments', new Blob(['a']), `file-${i}.txt`);
  assert.equal((await send(maximum)).status, 200);
  const large = new FormData();
  large.append('attachments', new Blob([Buffer.alloc(6 * 1024 * 1024)]), 'first.bin');
  large.append('attachments', new Blob([Buffer.alloc(5 * 1024 * 1024)]), 'second.bin');
  assert.equal((await send(large)).status, 413);
  const many = new FormData(); for (let i = 0; i < 11; i++) many.append('attachments', new Blob(['a']), `file-${i}.txt`);
  assert.equal((await send(many)).status, 400); assert.equal(accepted, 2);
});
