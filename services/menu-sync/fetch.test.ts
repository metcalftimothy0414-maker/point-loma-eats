import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { fetchForSync, FetchBlockedError } from './fetch.ts';

async function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('User-agent: *\nDisallow: /private\n');
      return;
    }
    if (req.url === '/private/menu') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>should never be fetched</html>');
      return;
    }
    if (req.url === '/cloudflare-challenge') {
      res.writeHead(403, { 'Content-Type': 'text/html' }).end('<html>Just a moment...</html>');
      return;
    }
    if (req.url === '/menu') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>Tacos $10</html>');
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('unexpected server address');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('fetchForSync throws FetchBlockedError for a robots.txt-disallowed path', async () => {
  const { server, baseUrl } = await startFixtureServer();
  try {
    await assert.rejects(() => fetchForSync(`${baseUrl}/private/menu`), FetchBlockedError);
  } finally {
    server.close();
  }
});

test('fetchForSync throws FetchBlockedError on a Cloudflare-style bot-challenge response', async () => {
  const { server, baseUrl } = await startFixtureServer();
  try {
    await assert.rejects(() => fetchForSync(`${baseUrl}/cloudflare-challenge`), FetchBlockedError);
  } finally {
    server.close();
  }
});

test('fetchForSync returns the body for an allowed, non-blocked path', async () => {
  const { server, baseUrl } = await startFixtureServer();
  try {
    const body = await fetchForSync(`${baseUrl}/menu`);
    assert.match(body, /Tacos \$10/);
  } finally {
    server.close();
  }
});
