import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideChanges, persistDecisions } from './apply.ts';
import type { ProposedChange } from './diff.ts';

function priceChange(oldPrice: number, newPrice: number): ProposedChange {
  return {
    changeType: 'price',
    menuItemId: 'item-1',
    oldValue: { basePrice: oldPrice },
    newValue: { basePrice: newPrice },
    confidence: 1,
  };
}

const SAFE_CONTEXT = { runConfidence: 1, totalExistingItems: 100, categoryRestructured: false };

test('price increase <= 5% auto-applies', () => {
  const [decision] = decideChanges([priceChange(10, 10.5)], SAFE_CONTEXT); // +5%
  assert.equal(decision.status, 'auto_applied');
});

test('price increase > 5% queues for review, does not auto-apply', () => {
  const [decision] = decideChanges([priceChange(10, 10.51)], SAFE_CONTEXT); // +5.1%
  assert.equal(decision.status, 'pending_review');
});

test('any price decrease auto-applies', () => {
  const [decision] = decideChanges([priceChange(10, 1)], SAFE_CONTEXT); // -90%
  assert.equal(decision.status, 'auto_applied');
});

test('new items and availability changes auto-apply', () => {
  const newItem: ProposedChange = {
    changeType: 'new',
    menuItemId: null,
    newValue: { name: 'Taco', description: null, basePrice: 5, isAvailable: true, sourceItemId: null, confidence: 1 },
    confidence: 1,
  };
  const availabilityChange: ProposedChange = {
    changeType: 'availability',
    menuItemId: 'item-1',
    oldValue: { isAvailable: true },
    newValue: { isAvailable: false },
    confidence: 1,
  };

  const decisions = decideChanges([newItem, availabilityChange], SAFE_CONTEXT);
  assert.ok(decisions.every((d) => d.status === 'auto_applied'));
});

test('deletions always queue for review, never auto-apply', () => {
  const deleteChange: ProposedChange = {
    changeType: 'delete',
    menuItemId: 'item-1',
    oldValue: { name: 'Taco', basePrice: 5 },
    confidence: 1,
  };
  const [decision] = decideChanges([deleteChange], SAFE_CONTEXT);
  assert.equal(decision.status, 'pending_review');
});

test('low confidence forces every change in the run to pending_review, even a safe one', () => {
  const decisions = decideChanges([priceChange(10, 9)], { ...SAFE_CONTEXT, runConfidence: 0.5 });
  assert.equal(decisions[0].status, 'pending_review');
});

test('> 30% churn forces the entire run to pending_review', () => {
  // 4 changes out of 10 existing items = 40% churn
  const changes = Array.from({ length: 4 }, () => priceChange(10, 9));
  const decisions = decideChanges(changes, { ...SAFE_CONTEXT, totalExistingItems: 10 });
  assert.ok(decisions.every((d) => d.status === 'pending_review'));
});

test('<= 30% churn does not by itself force review', () => {
  const changes = Array.from({ length: 3 }, () => priceChange(10, 9));
  const decisions = decideChanges(changes, { ...SAFE_CONTEXT, totalExistingItems: 10 });
  assert.ok(decisions.every((d) => d.status === 'auto_applied'));
});

test('category restructuring forces the entire run to pending_review', () => {
  const decisions = decideChanges([priceChange(10, 9)], { ...SAFE_CONTEXT, categoryRestructured: true });
  assert.equal(decisions[0].status, 'pending_review');
});

// --- persistDecisions: writes go where they should, and never touch display_price ---

type RecordedCall = { table: string; method: string; args: unknown[] };

function createFakeSupabase() {
  const calls: RecordedCall[] = [];

  function makeChain(table: string) {
    const chain = {
      insert(payload: unknown) {
        calls.push({ table, method: 'insert', args: [payload] });
        return chain;
      },
      update(payload: unknown) {
        calls.push({ table, method: 'update', args: [payload] });
        return chain;
      },
      eq(column: string, value: unknown) {
        calls.push({ table, method: 'eq', args: [column, value] });
        return chain;
      },
      then(resolve: (v: { error: null }) => void) {
        resolve({ error: null });
      },
    };
    return chain;
  }

  return { calls, from: (table: string) => makeChain(table) };
}

test('persistDecisions never writes display_price, and guards updates with manual_override = false', async () => {
  const fake = createFakeSupabase();
  const change = priceChange(10, 10.2);
  const decisions = decideChanges([change], SAFE_CONTEXT);

  await persistDecisions(fake as unknown as SupabaseClient, 'run-1', 'restaurant-1', decisions);

  const menuItemWrites = fake.calls.filter((c) => c.table === 'menu_items' && (c.method === 'insert' || c.method === 'update'));
  assert.ok(menuItemWrites.length > 0, 'expected at least one menu_items write');
  for (const write of menuItemWrites) {
    const payload = write.args[0] as Record<string, unknown>;
    assert.ok(!('display_price' in payload), 'display_price must never be written directly');
  }

  const manualOverrideGuard = fake.calls.some(
    (c) => c.table === 'menu_items' && c.method === 'eq' && c.args[0] === 'manual_override' && c.args[1] === false
  );
  assert.ok(manualOverrideGuard, 'expected an .eq("manual_override", false) guard on the update');

  const changeLogInsert = fake.calls.find((c) => c.table === 'menu_item_changes' && c.method === 'insert');
  assert.ok(changeLogInsert, 'expected a menu_item_changes row to be recorded');
});

test('persistDecisions does not write to menu_items at all for a pending_review change', async () => {
  const fake = createFakeSupabase();
  const change = priceChange(10, 20); // +100%, well over 5% -> queued, not applied
  const decisions = decideChanges([change], SAFE_CONTEXT);

  await persistDecisions(fake as unknown as SupabaseClient, 'run-1', 'restaurant-1', decisions);

  const menuItemWrites = fake.calls.filter((c) => c.table === 'menu_items');
  assert.equal(menuItemWrites.length, 0);

  const changeLogInsert = fake.calls.find((c) => c.table === 'menu_item_changes' && c.method === 'insert');
  assert.ok(changeLogInsert);
});
