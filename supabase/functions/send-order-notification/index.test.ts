import { assertEquals } from 'jsr:@std/assert';
import { selectNotifications } from './index.ts';

Deno.test('CONFIRMED notifies the customer, not the courier', () => {
  const { customer, courier } = selectNotifications('CONFIRMED', true);
  assertEquals(customer?.title, 'Order confirmed');
  assertEquals(courier, null);
});

Deno.test('COURIER_ASSIGNED notifies the courier, not the customer', () => {
  const { customer, courier } = selectNotifications('COURIER_ASSIGNED', true);
  assertEquals(customer, null);
  assertEquals(courier?.title, 'New order');
});

Deno.test('CANCELLED notifies both customer and courier when a courier is assigned', () => {
  const { customer, courier } = selectNotifications('CANCELLED', true);
  assertEquals(customer?.title, 'Order cancelled');
  assertEquals(courier?.title, 'Order cancelled');
});

Deno.test('CANCELLED with no courier assigned only notifies the customer', () => {
  const { customer, courier } = selectNotifications('CANCELLED', false);
  assertEquals(customer?.title, 'Order cancelled');
  assertEquals(courier, null);
});

Deno.test('internal-only statuses (PAYMENT_PENDING, COURIER_ACCEPTED, ON_INSTALLATION) notify no one', () => {
  for (const status of ['PAYMENT_PENDING', 'COURIER_ACCEPTED', 'ON_INSTALLATION'] as const) {
    const { customer, courier } = selectNotifications(status, true);
    assertEquals(customer, null, `expected no customer notification for ${status}`);
    assertEquals(courier, null, `expected no courier notification for ${status}`);
  }
});

Deno.test('every customer-facing milestone from the brief has content', () => {
  for (const status of ['CONFIRMED', 'ORDER_PICKED_UP', 'EN_ROUTE', 'APPROACHING', 'ARRIVED', 'DELIVERED', 'REFUNDED'] as const) {
    const { customer } = selectNotifications(status, false);
    if (!customer) throw new Error(`expected customer notification content for ${status}`);
  }
});
