#!/usr/bin/env node
/**
 * Tiny HTTP receiver for local development: answers every request with 200
 * and logs it. The dev n8n instance points its write node here through
 * host.docker.internal so that real executions have somewhere to send data.
 *
 *   node scripts/dev-receiver.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8787);
let seq = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    seq += 1;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${body.slice(0, 200)}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, id: `dev-${seq}` }));
  });
}).listen(port, '0.0.0.0', () => console.log(`dev receiver listening on ${port}`));
