// Shared contract every adapter (toast.ts, square.ts, clover.ts, chownow.ts,
// generic.ts) returns, before normalize.ts turns it into our schema shape.
// "Same interface" per the pipeline design means: this type — adapters may
// still disagree on price formatting (string vs number), which is exactly
// what normalize.ts exists to iron out.

export type SourcePlatform = 'toast' | 'square' | 'clover' | 'chownow' | 'generic';

export interface RawMenuItem {
  name: string;
  description?: string | null;
  /** Adapter-native price — dollars, may be "12.99" or 12.99 depending on
   * the source. Canonicalized to a number by normalize.ts, not here. */
  price: string | number;
  /** Platform's own id for this item, carried through so future syncs can
   * match against menu_items.source_item_id instead of matching by name. */
  externalId?: string | null;
  available?: boolean;
}

export interface RawMenuCategory {
  name: string;
  items: RawMenuItem[];
}

export interface AdapterResult {
  sourcePlatform: SourcePlatform;
  sourceUrl: string;
  categories: RawMenuCategory[];
  /** Adapter's own confidence in what it extracted, 0-1. Structured-API
   * adapters (toast/square/clover/chownow) should report 1 — the data came
   * from a documented API, nothing was reconstructed. generic.ts (Claude
   * vision fallback parsing arbitrary HTML/PDF) is the one expected to
   * report less than 1. */
  confidence: number;
}

// --- normalize.ts output: shaped to match our schema columns directly ------

export interface NormalizedMenuItem {
  name: string;
  description: string | null;
  /** Canonical dollar amount: always a number, always rounded to cents. */
  basePrice: number;
  isAvailable: boolean;
  sourceItemId: string | null;
  confidence: number;
}

export interface NormalizedMenuCategory {
  name: string;
  sortOrder: number;
  items: NormalizedMenuItem[];
}

export interface NormalizedMenu {
  restaurantId: string;
  sourcePlatform: SourcePlatform;
  sourceUrl: string;
  categories: NormalizedMenuCategory[];
  /** Run-level confidence: the adapter's confidence, discounted by anything
   * normalize.ts had to drop (e.g. unparseable prices). diff.ts/apply.ts
   * (not built yet) compare this against the 0.85 auto-apply threshold. */
  confidence: number;
}
