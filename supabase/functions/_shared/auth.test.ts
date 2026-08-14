import { assertEquals } from 'jsr:@std/assert';
import { isAuthorized } from './auth.ts';

Deno.test('fails closed when no secret is configured, regardless of what is provided', () => {
  assertEquals(isAuthorized(undefined, null), false);
  assertEquals(isAuthorized(undefined, 'anything'), false);
  assertEquals(isAuthorized('', 'anything'), false);
  assertEquals(isAuthorized('', ''), false);
});

Deno.test('denies when a secret is configured but nothing (or the wrong thing) is provided', () => {
  assertEquals(isAuthorized('secret123', null), false);
  assertEquals(isAuthorized('secret123', 'wrong'), false);
  assertEquals(isAuthorized('secret123', ''), false);
});

Deno.test('allows only an exact match when a secret is configured', () => {
  assertEquals(isAuthorized('secret123', 'secret123'), true);
});
