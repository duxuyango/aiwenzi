import {test} from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../pages-gateway.mjs';
import {createWorker} from '../engine.mjs';
import {readFile} from 'node:fs/promises';

const providers = JSON.parse(await readFile(new URL('../../providers.json', import.meta.url)));
const profiles = JSON.parse(await readFile(new URL('../../profiles.json', import.meta.url)));
const backend = createWorker({providers, profiles, prompts: {system: '', review: '', revise: ''}});
const origin = 'https://aiwenzi.pages.dev';
const env = {LITERARY_API: {fetch: request => backend.fetch(request)}};

test('Pages forwards the original request and streams API responses without buffering', async () => {
  const request = new Request(origin + '/api/write', {method: 'POST', headers: {Origin: origin}, body: '{}'});
  const stream = new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{"type":"progress"}\n')); controller.close();}});
  const response = new Response(stream, {headers: {'Content-Type': 'application/x-ndjson'}});
  const actual = await gateway.fetch(request, {LITERARY_API: {fetch(value) {assert.equal(value, request); return response;}}});
  assert.equal(actual, response);
  assert.equal(await actual.text(), '{"type":"progress"}\n');
});
test('Pages URL works with backend origin protection; foreign origins remain rejected', async () => {
  const request = source => new Request(origin + '/api/models', {method: 'POST', headers: {Origin: source, 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal((await gateway.fetch(request(origin), env)).status, 400);
  assert.equal((await gateway.fetch(request('https://other.example'), env)).status, 403);
  assert.equal((await gateway.fetch(new Request(origin + '/api/health'), env)).status, 200);
});
test('Pages serves assets with restrictive headers and reports missing backend safely', async () => {
  const asset = await gateway.fetch(new Request(origin + '/'), {ASSETS: {fetch: () => new Response('<html>ai文字</html>')}});
  assert.match(asset.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.equal(asset.headers.get('Cache-Control'), 'no-store');
  assert.equal((await gateway.fetch(new Request(origin + '/', {method: 'POST'}), {})).status, 405);
  assert.equal((await gateway.fetch(new Request(origin + '/api/health'), {})).status, 503);
});
