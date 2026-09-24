/**
 * Pure helpers for the profile's location priority levels and the list of known locations.
 *
 * One rule runs through all of them: a place is in at most one level. Places are compared by
 * `locationKey`, so "Malmö" and "malmo" are the same place. Shared by the API (which enforces
 * the rule on every save) and the web app (which applies the same moves locally while the
 * user drags places between levels), so the two agree on what a move does.
 */

import { locationKey } from './normalize.js';

/** Same shape as `LocationTier` in `schemas.ts`, spelled out here to keep this module standalone. */
export interface PlaceTier {
  places: string[];
  share: number;
}

/** Where `place` is ranked: the index of its level, or -1 when it is in none. */
export function findPlaceTier(tiers: readonly PlaceTier[], place: string): number {
  const key = locationKey(place);
  return tiers.findIndex((tier) => tier.places.some((p) => locationKey(p) === key));
}

/** Every ranked place, best level first. */
export function rankedPlaces(tiers: readonly PlaceTier[]): string[] {
  return tiers.flatMap((tier) => tier.places);
}

/**
 * Each place kept only in its highest-priority level, blank places dropped, and levels left
 * empty removed. What a stored profile is read through, so a duplicate saved before the
 * one-level rule existed resolves to the priority the user ranked it highest at.
 */
export function dedupeLocationTiers<T extends PlaceTier>(tiers: readonly T[]): T[] {
  const seen = new Set<string>();
  return tiers
    .map((tier) => ({
      ...tier,
      places: tier.places.filter((place) => {
        const key = locationKey(place);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    }))
    .filter((tier) => tier.places.length > 0);
}

/** The first place found in more than one level, or null when every place is in one. */
export function duplicatePlace(tiers: readonly PlaceTier[]): string | null {
  const seen = new Set<string>();
  for (const place of rankedPlaces(tiers)) {
    const key = locationKey(place);
    if (seen.has(key)) return place;
    seen.add(key);
  }
  return null;
}

/** `place` taken out of whichever level holds it. Levels are kept even when left empty. */
export function withoutPlace(tiers: readonly PlaceTier[], place: string): PlaceTier[] {
  const key = locationKey(place);
  return tiers.map((tier) => ({ ...tier, places: tier.places.filter((p) => locationKey(p) !== key) }));
}

/**
 * `place` moved into level `to`, out of whichever level held it. `to` equal to the number of
 * levels starts a new level at `share`, so dropping a place past the last level ranks it
 * lowest. A negative `to` just unranks it.
 */
export function movePlace(tiers: readonly PlaceTier[], place: string, to: number, share = 0): PlaceTier[] {
  const next = withoutPlace(tiers, place);
  if (to < 0) return next;
  if (to >= next.length) return [...next, { places: [place], share }];
  return next.map((tier, index) => (index === to ? { ...tier, places: [...tier.places, place] } : tier));
}

/** Every occurrence of `from` renamed to `to`, keeping the result in one level only. */
export function renamePlace<T extends PlaceTier>(tiers: readonly T[], from: string, to: string): T[] {
  const key = locationKey(from);
  return dedupeLocationTiers(
    tiers.map((tier) => ({ ...tier, places: tier.places.map((p) => (locationKey(p) === key ? to : p)) })),
  );
}

/**
 * `places` with `extra` added, one entry per place and sorted alphabetically. The first
 * spelling of a place wins, so an existing entry is never silently re-spelled.
 */
export function mergePlaces(places: readonly string[], extra: readonly string[] = []): string[] {
  const byKey = new Map<string, string>();
  for (const place of [...places, ...extra]) {
    const label = place.replace(/\s+/g, ' ').trim();
    const key = locationKey(label);
    if (key && !byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
