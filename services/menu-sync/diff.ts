import type { NormalizedMenu, NormalizedMenuItem } from './types.ts';

export interface ExistingMenuItem {
  id: string;
  name: string;
  basePrice: number;
  isAvailable: boolean;
  sourceItemId: string | null;
}

export type ProposedChange =
  | { changeType: 'new'; menuItemId: null; newValue: NormalizedMenuItem; confidence: number }
  | {
      changeType: 'price';
      menuItemId: string;
      oldValue: { basePrice: number };
      newValue: { basePrice: number };
      confidence: number;
    }
  | {
      changeType: 'availability';
      menuItemId: string;
      oldValue: { isAvailable: boolean };
      newValue: { isAvailable: boolean };
      confidence: number;
    }
  | { changeType: 'delete'; menuItemId: string; oldValue: { name: string; basePrice: number }; confidence: number };

/**
 * Matches a normalized item to an existing row by sourceItemId when
 * available (stable across renames), falling back to exact
 * case-insensitive name match — normalize.ts doesn't guarantee
 * sourceItemId is always present (generic.ts's HTML/PDF extraction has no
 * platform id to carry through).
 */
function matchExisting(item: NormalizedMenuItem, existing: ExistingMenuItem[]): ExistingMenuItem | undefined {
  if (item.sourceItemId) {
    const bySourceId = existing.find((e) => e.sourceItemId === item.sourceItemId);
    if (bySourceId) return bySourceId;
  }
  return existing.find((e) => e.name.trim().toLowerCase() === item.name.trim().toLowerCase());
}

/**
 * Diffs a freshly normalized menu against the restaurant's current
 * menu_items. Callers are expected to have already excluded
 * manual_override items from `existing` — diff.ts has no override
 * awareness of its own on purpose, so that filtering happens exactly once
 * at the call site instead of being something every consumer has to
 * remember to apply.
 */
export function diffMenu(normalized: NormalizedMenu, existing: ExistingMenuItem[]): ProposedChange[] {
  const changes: ProposedChange[] = [];
  const matchedExistingIds = new Set<string>();

  const allNormalizedItems = normalized.categories.flatMap((c) => c.items);

  for (const item of allNormalizedItems) {
    const match = matchExisting(item, existing);

    if (!match) {
      changes.push({ changeType: 'new', menuItemId: null, newValue: item, confidence: item.confidence });
      continue;
    }

    matchedExistingIds.add(match.id);

    if (match.basePrice !== item.basePrice) {
      changes.push({
        changeType: 'price',
        menuItemId: match.id,
        oldValue: { basePrice: match.basePrice },
        newValue: { basePrice: item.basePrice },
        confidence: item.confidence,
      });
    }

    if (match.isAvailable !== item.isAvailable) {
      changes.push({
        changeType: 'availability',
        menuItemId: match.id,
        oldValue: { isAvailable: match.isAvailable },
        newValue: { isAvailable: item.isAvailable },
        confidence: item.confidence,
      });
    }
  }

  for (const existingItem of existing) {
    if (!matchedExistingIds.has(existingItem.id)) {
      changes.push({
        changeType: 'delete',
        menuItemId: existingItem.id,
        oldValue: { name: existingItem.name, basePrice: existingItem.basePrice },
        confidence: normalized.confidence,
      });
    }
  }

  return changes;
}
