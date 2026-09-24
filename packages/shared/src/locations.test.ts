import { describe, expect, it } from 'vitest';
import { dedupeLocationTiers, duplicatePlace, findPlaceTier, mergePlaces, movePlace, renamePlace, withoutPlace } from './locations.js';

const tiers = () => [
  { places: ['Stockholm', 'Uppsala'], share: 100 },
  { places: ['Malmö'], share: 50 },
];

describe('location priority levels', () => {
  it('finds a place by its key, ignoring case and accents', () => {
    expect(findPlaceTier(tiers(), 'malmo')).toBe(1);
    expect(findPlaceTier(tiers(), 'Lund')).toBe(-1);
  });

  it('moves a place between levels without leaving a copy behind', () => {
    expect(movePlace(tiers(), 'Uppsala', 1)).toEqual([
      { places: ['Stockholm'], share: 100 },
      { places: ['Malmö', 'Uppsala'], share: 50 },
    ]);
  });

  it('starts a new, lowest level when moved past the last one', () => {
    expect(movePlace(tiers(), 'Malmö', 2, 25)).toEqual([
      { places: ['Stockholm', 'Uppsala'], share: 100 },
      { places: [], share: 50 },
      { places: ['Malmö'], share: 25 },
    ]);
  });

  it('unranks a place, keeping the level it left', () => {
    expect(withoutPlace(tiers(), 'malmö')).toEqual([
      { places: ['Stockholm', 'Uppsala'], share: 100 },
      { places: [], share: 50 },
    ]);
    expect(movePlace(tiers(), 'Malmö', -1)).toEqual(withoutPlace(tiers(), 'Malmö'));
  });

  it('keeps a duplicate in its highest level and drops levels left empty', () => {
    const doubled = [...tiers(), { places: ['Stockholm', ' '], share: 20 }];
    expect(duplicatePlace(doubled)).toBe('Stockholm');
    expect(dedupeLocationTiers(doubled)).toEqual(tiers());
    expect(duplicatePlace(tiers())).toBeNull();
  });

  it('renames onto an existing place by merging into the higher level', () => {
    expect(renamePlace(tiers(), 'Malmö', 'uppsala')).toEqual([{ places: ['Stockholm', 'Uppsala'], share: 100 }]);
    expect(renamePlace(tiers(), 'Malmö', 'Lund')).toEqual([
      { places: ['Stockholm', 'Uppsala'], share: 100 },
      { places: ['Lund'], share: 50 },
    ]);
  });
});

describe('mergePlaces', () => {
  it('keeps one entry per place, the first spelling, alphabetical', () => {
    expect(mergePlaces(['Uppsala', 'Malmö'], ['malmo', ' Lund  ', 'Umeå', ''])).toEqual(['Lund', 'Malmö', 'Umeå', 'Uppsala']);
  });
});
