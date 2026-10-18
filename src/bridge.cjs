'use strict';
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

function authorized(header, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function createBridge({ token, onUpdate, port = 47831, onError = () => {} }) {
  const server = http.createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    // No browser origins, cookies or CORS. A website must not control a desktop pet.
    if (request.headers.origin || !/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host || '')) return reply(403, { error: 'Forbidden origin or host' });
    if (!authorized(request.headers.authorization, token)) return reply(401, { error: 'Unauthorized' });
    if (request.method === 'GET' && request.url === '/v1/health') return reply(200, { ok: true, version: 1 });
    if (request.method !== 'POST' || request.url !== '/v1/state') return reply(404, { error: 'Not found' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return reply(415, { error: 'Use application/json' });
    let size = 0, tooLarge = false, chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) {
        if (!tooLarge) { tooLarge = true; chunks = []; reply(413, { error: 'Body too large' }); }
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        onUpdate(input);
        reply(200, { ok: true });
      } catch (error) {
        reply(error instanceof TypeError || error instanceof SyntaxError ? 400 : 500,
          { error: error instanceof TypeError ? error.message : 'Invalid update or storage unavailable' });
      }
    });
    request.on('error', () => {});
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 16;
  server.on('error', onError);
  server.listen(port, '127.0.0.1');
  return server;
}
module.exports = { createBridge, authorized };
