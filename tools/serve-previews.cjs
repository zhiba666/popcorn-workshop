'use strict';

const http = require('node:http');
const { createPreviewHandler } = require('./preview-server.cjs');
const port = Number(process.env.POPCORN_PREVIEW_PORT || 8766);

const server = http.createServer(createPreviewHandler('preview/index.html'));
server.listen(port, '127.0.0.1', () => {
  console.log(`预览首页：http://127.0.0.1:${server.address().port}/`);
});
