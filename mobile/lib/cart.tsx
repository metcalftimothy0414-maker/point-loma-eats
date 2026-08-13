import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type CartItem = {
  menuItemId: string;
  name: string;
  displayPrice: number;
  qty: number;
};

type CartContextValue = {
  restaurantId: string | null;
  restaurantName: string | null;
  items: CartItem[];
  subtotal: number;
  addItem: (restaurantId: string, restaurantName: string, item: Omit<CartItem, 'qty'>) => void;
  updateQty: (menuItemId: string, qty: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);

  // ponytail: switching restaurants clears the cart outright instead of
  // prompting to merge or replace — one restaurant per order is the norm for
  // this kind of app. Add a confirmation dialog if that turns out jarring.
  function addItem(newRestaurantId: string, newRestaurantName: string, item: Omit<CartItem, 'qty'>) {
    setItems((prev) => {
      const base = restaurantId !== null && restaurantId !== newRestaurantId ? [] : prev;
      const existing = base.find((i) => i.menuItemId === item.menuItemId);
      if (existing) {
        return base.map((i) => (i.menuItemId === item.menuItemId ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...base, { ...item, qty: 1 }];
    });
    setRestaurantId(newRestaurantId);
    setRestaurantName(newRestaurantName);
  }

  function updateQty(menuItemId: string, qty: number) {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((i) => i.menuItemId !== menuItemId)
        : prev.map((i) => (i.menuItemId === menuItemId ? { ...i, qty } : i))
    );
  }

  function clear() {
    setItems([]);
    setRestaurantId(null);
    setRestaurantName(null);
  }

  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.displayPrice * i.qty, 0), [items]);

  return (
    <CartContext.Provider value={{ restaurantId, restaurantName, items, subtotal, addItem, updateQty, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
