import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMenu, type ExistingMenuItem } from './diff.ts';
import type { NormalizedMenu } from './types.ts';

function menu(items: NormalizedMenu['categories'][number]['items']): NormalizedMenu {
  return {
    restaurantId: 'r1',
    sourcePlatform: 'generic',
    sourceUrl: 'https://example.com',
    confidence: 1,
    categories: [{ name: 'Mains', sortOrder: 0, items }],
  };
}

test('detects a new item not present in existing rows', () => {
  const existing: ExistingMenuItem[] = [];
  const changes = diffMenu(
    menu([{ name: 'Taco', description: null, basePrice: 5, isAvailable: true, sourceItemId: null, confidence: 1 }]),
    existing
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeType, 'new');
});

test('detects a price change on a matched item', () => {
  const existing: ExistingMenuItem[] = [
    { id: 'item-1', name: 'Taco', basePrice: 5, isAvailable: true, sourceItemId: null },
  ];
  const changes = diffMenu(
    menu([{ name: 'Taco', description: null, basePrice: 6, isAvailable: true, sourceItemId: null, confidence: 1 }]),
    existing
  );

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    changeType: 'price',
    menuItemId: 'item-1',
    oldValue: { basePrice: 5 },
    newValue: { basePrice: 6 },
    confidence: 1,
  });
});

test('detects an availability change', () => {
  const existing: ExistingMenuItem[] = [
    { id: 'item-1', name: 'Taco', basePrice: 5, isAvailable: true, sourceItemId: null },
  ];
  const changes = diffMenu(
    menu([{ name: 'Taco', description: null, basePrice: 5, isAvailable: false, sourceItemId: null, confidence: 1 }]),
    existing
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeType, 'availability');
});

test('detects a deletion for an existing item missing from the new menu', () => {
  const existing: ExistingMenuItem[] = [
    { id: 'item-1', name: 'Taco', basePrice: 5, isAvailable: true, sourceItemId: null },
  ];
  const changes = diffMenu(menu([]), existing);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeType, 'delete');
  assert.equal(changes[0].menuItemId, 'item-1');
});

test('matches by sourceItemId even if the name changed', () => {
  const existing: ExistingMenuItem[] = [
    { id: 'item-1', name: 'Old Name', basePrice: 5, isAvailable: true, sourceItemId: 'ext-1' },
  ];
  const changes = diffMenu(
    menu([{ name: 'New Name', description: null, basePrice: 5, isAvailable: true, sourceItemId: 'ext-1', confidence: 1 }]),
    existing
  );

  // No delete + new pair — it's recognized as the same item, just renamed,
  // and a name-only change isn't one of our tracked change types.
  assert.equal(changes.length, 0);
});

test('an untouched item produces no changes', () => {
  const existing: ExistingMenuItem[] = [
    { id: 'item-1', name: 'Taco', basePrice: 5, isAvailable: true, sourceItemId: null },
  ];
  const changes = diffMenu(
    menu([{ name: 'Taco', description: null, basePrice: 5, isAvailable: true, sourceItemId: null, confidence: 1 }]),
    existing
  );

  assert.equal(changes.length, 0);
});
