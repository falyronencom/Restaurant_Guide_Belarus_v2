import {
  boundsOfFeatures,
  bubbleTier,
  toClusterFeatures,
} from '@/components/map/MapView';
import type { PublicEstablishmentMapMarker } from '@/lib/api/types';

/*
 * Clustering logic for the interactive map (Slice D part 2). The clusterer
 * itself is Yandex's (@yandex/ymaps3-clusterer, bundled and dynamically
 * imported) — it needs a live WebGL map, so it is neither testable here nor
 * ours to test. What IS ours is the seam: the input we hand it, the bubble
 * steps, and the camera target a bubble click produces. Those are pure
 * functions precisely so they can be pinned without a live map.
 */

function marker(
  over: Partial<PublicEstablishmentMapMarker> = {},
): PublicEstablishmentMapMarker {
  return {
    id: 'id-1',
    slug: 'test-cafe',
    name: 'Тестовое кафе',
    city: 'Минск',
    city_slug: 'minsk',
    address: 'ул. Тестовая, 1',
    categories: ['Кафе'],
    category_slug: 'cafes',
    price_range: '$$',
    latitude: 53.9023,
    longitude: 27.5615,
    primary_image_url: null,
    review_count: 0,
    average_rating: null,
    has_promotion: false,
    ...over,
  };
}

describe('toClusterFeatures', () => {
  it('projects a marker to the clusterer feature shape', () => {
    expect(toClusterFeatures([marker({ id: 'abc' })])).toEqual([
      {
        type: 'Feature',
        id: 'abc',
        geometry: { type: 'Point', coordinates: [27.5615, 53.9023] },
      },
    ]);
  });

  it('emits coordinates longitude-first (Yandex order, not lat/lng)', () => {
    const [feature] = toClusterFeatures([
      marker({ latitude: 53.9023, longitude: 27.5615 }),
    ]);
    const [lng, lat] = feature.geometry.coordinates;
    expect(lng).toBe(27.5615);
    expect(lat).toBe(53.9023);
  });

  it('drops markers the map cannot place', () => {
    const features = toClusterFeatures([
      marker({ id: 'placeable' }),
      marker({ id: 'no-lat', latitude: null }),
      marker({ id: 'no-lng', longitude: null }),
      marker({ id: 'neither', latitude: null, longitude: null }),
    ]);
    expect(features.map((f) => f.id)).toEqual(['placeable']);
  });

  it('passes the whole placeable set through — one feature per establishment', () => {
    // 257 is the real Minsk-bbox density of the launch seed, and the count the
    // badge ultimately shows. Nothing here may collapse or group: the clusterer
    // is what draws six bubbles from these, and it must receive all 257.
    const data = Array.from({ length: 257 }, (_, i) => marker({ id: `e-${i}` }));
    const features = toClusterFeatures(data);
    expect(features).toHaveLength(257);
    expect(new Set(features.map((f) => f.id)).size).toBe(257);
  });

  it('keeps zero coordinates, which are placeable (only null is not)', () => {
    expect(toClusterFeatures([marker({ latitude: 0, longitude: 0 })])).toHaveLength(
      1,
    );
  });
});

describe('bubbleTier', () => {
  it('steps at <10 / 10-49 / 50+', () => {
    expect(bubbleTier(2).size).toBe(bubbleTier(9).size);
    expect(bubbleTier(10).size).toBe(bubbleTier(49).size);
    expect(bubbleTier(50).size).toBe(bubbleTier(300).size);
  });

  it('grows monotonically across the steps', () => {
    expect(bubbleTier(9).size).toBeLessThan(bubbleTier(10).size);
    expect(bubbleTier(49).size).toBeLessThan(bubbleTier(50).size);
    expect(bubbleTier(9).font).toBeLessThan(bubbleTier(50).font);
  });

  it('gives a usable size for any group a clusterer can produce', () => {
    for (const n of [2, 3, 9, 10, 11, 49, 50, 51, 257, 500]) {
      expect(bubbleTier(n).size).toBeGreaterThan(0);
      expect(bubbleTier(n).font).toBeGreaterThan(0);
    }
  });
});

describe('boundsOfFeatures', () => {
  const at = (id: string, lng: number, lat: number) =>
    toClusterFeatures([marker({ id, longitude: lng, latitude: lat })])[0];

  it('returns null for an empty group', () => {
    expect(boundsOfFeatures([])).toBeNull();
  });

  /*
   * Corner order is the whole point of these assertions. ymaps3 wants
   * [top-left, bottom-right] — north latitude in the FIRST corner. A south-first
   * rectangle is not rejected; the camera quietly reads the inverted box as
   * degenerate and jumps to max zoom, which looks like "clustering is broken"
   * rather than "the bounds are upside down". Verified against a live map.
   */
  it('spans the members as [top-left, bottom-right] — north first', () => {
    const bounds = boundsOfFeatures([
      at('a', 27.5, 53.9),
      at('b', 27.6, 54.0),
      at('c', 27.55, 53.95),
    ]);
    expect(bounds).toEqual([
      [27.5, 54.0], // west + north
      [27.6, 53.9], // east + south
    ]);
  });

  it('keeps the north corner north for any member order', () => {
    const bounds = boundsOfFeatures([at('a', 27.6, 54.0), at('b', 27.5, 53.9)]);
    const [[, firstLat], [, secondLat]] = bounds!;
    expect(firstLat).toBeGreaterThan(secondLat);
  });

  it('applies a usable floor with no minSpan argument — pins the shipped default', () => {
    // Every other case passes an explicit span, which would let a typo in the
    // production constant through green. A coincident pair is the case the
    // default exists for: the box must come out small but non-degenerate.
    const bounds = boundsOfFeatures([
      at('a', 27.5615, 53.9023),
      at('b', 27.5615, 53.9023),
    ]);
    const [[west, north], [east, south]] = bounds!;
    const lngSpan = east - west;
    const latSpan = north - south;
    expect(lngSpan).toBeGreaterThan(0);
    expect(latSpan).toBeGreaterThan(0);
    // Honesty audit 2026-09-07: a band («small, not a continent») does not pin
    // a default — CLUSTER_MIN_SPAN could drift 0.0015 → 0.008 with this file
    // green (mutation M61). The shipped value is pinned exactly, as the title
    // claims; the band above stays as the sanity floor.
    expect(lngSpan).toBeCloseTo(0.0015, 10);
    expect(latSpan).toBeCloseTo(0.0015, 10);
    expect((west + east) / 2).toBeCloseTo(27.5615, 10);
  });

  it('floors a coincident group to a usable span around its own point', () => {
    // Two establishments at one address would otherwise give a zero-extent box,
    // which is not a camera target the map can act on.
    const bounds = boundsOfFeatures(
      [at('a', 27.5615, 53.9023), at('b', 27.5615, 53.9023)],
      0.002,
    );
    expect(bounds).not.toBeNull();
    const [[west, north], [east, south]] = bounds!;
    expect(east - west).toBeCloseTo(0.002, 10);
    expect(north - south).toBeCloseTo(0.002, 10);
    // Padding is symmetric: the group stays centred where it actually is.
    expect((west + east) / 2).toBeCloseTo(27.5615, 10);
    expect((south + north) / 2).toBeCloseTo(53.9023, 10);
  });

  it('leaves a group wider than the floor untouched', () => {
    const bounds = boundsOfFeatures([at('a', 27.0, 53.0), at('b', 28.0, 54.0)], 0.002);
    expect(bounds).toEqual([
      [27.0, 54.0],
      [28.0, 53.0],
    ]);
  });

  it('floors only the axis that needs it', () => {
    // A row of places along one street: wide in longitude, flat in latitude.
    const bounds = boundsOfFeatures([at('a', 27.5, 53.9), at('b', 27.6, 53.9)], 0.002);
    const [[west, north], [east, south]] = bounds!;
    expect(east - west).toBeCloseTo(0.1, 10);
    expect(north - south).toBeCloseTo(0.002, 10);
  });
});
