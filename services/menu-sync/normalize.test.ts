import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.ts';
import type { AdapterResult } from './types.ts';

test('normalizes a clean structured-API result at full confidence', () => {
  const result: AdapterResult = {
    sourcePlatform: 'toast',
    sourceUrl: 'https://example.com/menu',
    confidence: 1,
    categories: [
      {
        name: 'Tacos',
        items: [{ name: 'Carne Asada', price: '10.00', externalId: 'abc123' }],
      },
    ],
  };

  const normalized = normalize(result, 'restaurant-1');

  assert.equal(normalized.confidence, 1);
  assert.equal(normalized.categories.length, 1);
  assert.deepEqual(normalized.categories[0].items[0], {
    name: 'Carne Asada',
    description: null,
    basePrice: 10,
    isAvailable: true,
    sourceItemId: 'abc123',
    confidence: 1,
  });
});

test('parses "$10.99"-style strings and rounds to the cent', () => {
  const result: AdapterResult = {
    sourcePlatform: 'generic',
    sourceUrl: 'https://example.com/menu',
    confidence: 0.9,
    categories: [{ name: 'Drinks', items: [{ name: 'Cortado', price: '$4.999' }] }],
  };

  const normalized = normalize(result, 'restaurant-1');

  assert.equal(normalized.categories[0].items[0].basePrice, 5);
});

test('drops items with an unparseable price and discounts run confidence', () => {
  const result: AdapterResult = {
    sourcePlatform: 'generic',
    sourceUrl: 'https://example.com/menu',
    confidence: 0.9,
    categories: [
      {
        name: 'Specials',
        items: [
          { name: 'Good Item', price: '8.00' },
          { name: 'Market Price Item', price: 'Market Price' },
        ],
      },
    ],
  };

  const normalized = normalize(result, 'restaurant-1');

  assert.equal(normalized.categories[0].items.length, 1);
  assert.equal(normalized.categories[0].items[0].name, 'Good Item');
  // 1 of 2 items dropped -> 0.5 drop rate -> 0.9 - 0.5 = 0.4
  assert.equal(normalized.confidence, 0.4);
});

test('never lets confidence go negative even with a total-loss parse', () => {
  const result: AdapterResult = {
    sourcePlatform: 'generic',
    sourceUrl: 'https://example.com/menu',
    confidence: 0.2,
    categories: [{ name: 'Everything', items: [{ name: 'Unparseable', price: 'ask staff' }] }],
  };

  const normalized = normalize(result, 'restaurant-1');

  assert.equal(normalized.categories[0].items.length, 0);
  assert.equal(normalized.confidence, 0);
});

test('throws on structurally invalid adapter output instead of silently dropping it', () => {
  const malformed = {
    sourcePlatform: 'toast',
    sourceUrl: 'https://example.com/menu',
    confidence: 1,
    categories: [{ name: 'Tacos', items: [{ price: '10.00' }] }], // missing name
  };

  assert.throws(() => normalize(malformed as unknown as AdapterResult, 'restaurant-1'));
});
