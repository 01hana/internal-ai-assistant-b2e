#!/usr/bin/env node
'use strict';

const { createServer, request } = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3110;
const PATH = '/.well-known/jwks.json';
const UPSTREAM_JWKS_URL = 'http://127.0.0.1:3107/.well-known/jwks.json';
const MAX_RESPONSE_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 5000;

function createLocalJwksProxy(input = {}) {
  const requestUpstream = input.requestUpstream ?? fetchBridgeJwks;
  return createServer((incoming, outgoing) => {
    void handle(incoming, outgoing, requestUpstream);
  });
}

async function handle(incoming, outgoing, requestUpstream) {
  if (incoming.method !== 'GET') {
    incoming.resume();
    outgoing.setHeader('allow', 'GET');
    return send(outgoing, 405, { error: 'method_not_allowed' });
  }
  if (incoming.url !== PATH) {
    incoming.resume();
    return send(outgoing, 404, { error: 'not_found' });
  }

  try {
    const upstream = await requestUpstream();
    if (!upstream || upstream.statusCode !== 200 || !isJsonContentType(upstream.headers?.['content-type'])) throw new Error('invalid');
    const body = await boundedBody(upstream.body);
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    const normalized = Buffer.from(JSON.stringify(parsed));
    if (normalized.length > MAX_RESPONSE_BYTES) throw new Error('invalid');
    outgoing.statusCode = 200;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.setHeader('cache-control', 'no-store');
    outgoing.setHeader('content-length', String(normalized.length));
    outgoing.end(normalized);
  } catch {
    send(outgoing, 502, { error: 'jwks_upstream_unavailable' });
  }
}

function fetchBridgeJwks() {
  return new Promise((resolve, reject) => {
    const upstream = request(UPSTREAM_JWKS_URL, {
      method: 'GET',
      headers: { accept: 'application/json, application/jwk-set+json' },
      timeout: UPSTREAM_TIMEOUT_MS
    }, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response }));
    upstream.once('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.once('error', reject);
    upstream.end();
  });
}

async function boundedBody(body) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') throw new Error('invalid');
  const parts = [];
  let length = 0;
  for await (const part of body) {
    const bytes = Buffer.from(part);
    length += bytes.length;
    if (length > MAX_RESPONSE_BYTES) throw new Error('invalid');
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

function isJsonContentType(value) {
  const contentType = Array.isArray(value) ? value[0] : value;
  return typeof contentType === 'string' && /^(application\/json|application\/jwk-set\+json)(?:\s*;|$)/i.test(contentType);
}

function send(response, statusCode, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.setHeader('content-length', String(encoded.length));
  response.end(encoded);
}

function startLocalJwksProxy() {
  const server = createLocalJwksProxy();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`LOCAL_JWKS_ONLY_PROXY_READY=YES\nLOCAL_JWKS_PROXY_ORIGIN=http://${HOST}:${PORT}\n`);
  });
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.once('error', () => {
    process.stderr.write('Local JWKS-only proxy failed.\n');
    process.exitCode = 1;
  });
  return server;
}

module.exports = { HOST, PORT, PATH, UPSTREAM_JWKS_URL, MAX_RESPONSE_BYTES, createLocalJwksProxy, handleLocalJwksRequest: handle, startLocalJwksProxy };

if (require.main === module) startLocalJwksProxy();
