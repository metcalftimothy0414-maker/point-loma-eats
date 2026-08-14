import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from './http-server.ts';

test('fails closed when no secret is configured, regardless of what is provided', () => {
  assert.equal(isAuthorized(undefined, undefined), false);
  assert.equal(isAuthorized(undefined, 'anything'), false);
  assert.equal(isAuthorized('', 'anything'), false);
});

test('denies when a secret is configured but nothing (or the wrong thing) is provided', () => {
  assert.equal(isAuthorized('secret123', undefined), false);
  assert.equal(isAuthorized('secret123', 'wrong'), false);
});

test('allows only an exact match when a secret is configured', () => {
  assert.equal(isAuthorized('secret123', 'secret123'), true);
});

test('a repeated header (array) never matches, even if it contains the right value', () => {
  // Node types a repeated header as string[] — an array is never === a
  // string, so this correctly denies rather than needing special-case
  // array-handling logic that could itself hide a bug.
  assert.equal(isAuthorized('secret123', ['secret123']), false);
});
