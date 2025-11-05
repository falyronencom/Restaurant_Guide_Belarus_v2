/**
 * Belarus Geography Test Fixtures
 *
 * Real coordinates for Belarus cities and test locations.
 * Used for geospatial query testing with PostGIS.
 */

/**
 * Major Belarus cities with accurate coordinates
 */
export const belarusCities = {
  minsk: {
    name: 'Минск',
    lat: 53.9,
    lon: 27.5,
    description: 'Capital and largest city'
  },
  gomel: {
    name: 'Гомель',
    lat: 52.4,
    lon: 31.0,
    description: 'Second largest city, southeast'
  },
  brest: {
    name: 'Брест',
    lat: 52.1,
    lon: 23.7,
    description: 'Western border city'
  },
  grodno: {
    name: 'Гродно',
    lat: 53.7,
    lon: 23.8,
    description: 'Northwestern city'
  },
  vitebsk: {
    name: 'Витебск',
    lat: 55.2,
    lon: 30.2,
    description: 'Northern city'
  },
  mogilev: {
    name: 'Могилев',
    lat: 53.9,
    lon: 30.3,
    description: 'Eastern city'
  },
  bobruisk: {
    name: 'Бобруйск',
    lat: 53.1,
    lon: 29.2,
    description: 'Central city'
  }
};

/**
 * Specific Minsk locations for detailed testing
 */
export const minskLocations = {
  center: {
    name: 'Площадь Независимости',
    lat: 53.8938,
    lon: 27.5478,
    description: 'City center, Independence Square'
  },
  upperTown: {
    name: 'Верхний город',
    lat: 53.9045,
    lon: 27.5569,
    description: 'Historic district'
  },
  komarovsky: {
    name: 'Комаровский рынок',
    lat: 53.8828,
    lon: 27.5744,
    description: 'Popular market area'
  },
  victoryPark: {
    name: 'Парк Победы',
    lat: 53.9165,
    lon: 27.5333,
    description: 'Victory Park area'
  },
  railway: {
    name: 'Железнодорожный вокзал',
    lat: 53.8911,
    lon: 27.5508,
    description: 'Railway station area'
  }
};

/**
 * Geographic bounds for Belarus (for validation testing)
 */
export const belarusBounds = {
  LAT_MIN: 51.0,
  LAT_MAX: 56.0,
  LON_MIN: 23.0,
  LON_MAX: 33.0
};

/**
 * Invalid coordinates (outside Belarus) for negative testing
 */
export const invalidCoordinates = {
  moscow: {
    name: 'Москва (Россия)',
    lat: 55.7558,
    lon: 37.6173,
    description: 'Outside Belarus, east'
  },
  warsaw: {
    name: 'Варшава (Польша)',
    lat: 52.2297,
    lon: 21.0122,
    description: 'Outside Belarus, west'
  },
  vilnius: {
    name: 'Вильнюс (Литва)',
    lat: 54.6872,
    lon: 25.2797,
    description: 'Outside Belarus, northwest'
  },
  kiev: {
    name: 'Киев (Украина)',
    lat: 50.4501,
    lon: 30.5234,
    description: 'Outside Belarus, south'
  },
  northPole: {
    name: 'Северный полюс',
    lat: 90.0,
    lon: 0.0,
    description: 'Far outside Belarus'
  }
};

/**
 * Distance test scenarios
 * Pre-calculated distances for testing search radius
 */
export const distanceScenarios = {
  // From Minsk center to various locations
  minskCenter: {
    origin: belarusCities.minsk,
    nearby: [
      {
        location: minskLocations.center,
        distance: 0.0, // Same location
        description: 'Same point'
      },
      {
        location: minskLocations.railway,
        distance: 0.6, // ~600m
        description: 'Walking distance'
      },
      {
        location: minskLocations.komarovsky,
        distance: 3.2, // ~3.2km
        description: 'Short drive'
      }
    ],
    faraway: [
      {
        location: belarusCities.gomel,
        distance: 300, // ~300km
        description: 'Different city'
      },
      {
        location: belarusCities.brest,
        distance: 350, // ~350km
        description: 'Far western city'
      }
    ]
  }
};

/**
 * Test search areas with expected establishment counts
 * (populated by test seed data)
 */
export const searchAreas = {
  // Small radius - should find very few establishments
  verySmall: {
    center: belarusCities.minsk,
    radius: 1, // 1km
    expectedMin: 1,
    expectedMax: 10
  },
  // Medium radius - should find moderate number
  medium: {
    center: belarusCities.minsk,
    radius: 5, // 5km
    expectedMin: 10,
    expectedMax: 50
  },
  // Large radius - should find many establishments
  large: {
    center: belarusCities.minsk,
    radius: 10, // 10km
    expectedMin: 20,
    expectedMax: 100
  },
  // Empty area - should find nothing
  empty: {
    center: invalidCoordinates.northPole,
    radius: 100,
    expectedMin: 0,
    expectedMax: 0
  }
};

/**
 * Bounds for map view testing
 */
export const mapBounds = {
  // Entire Belarus
  fullCountry: {
    ne: { lat: belarusBounds.LAT_MAX, lon: belarusBounds.LON_MAX },
    sw: { lat: belarusBounds.LAT_MIN, lon: belarusBounds.LON_MIN },
    description: 'Entire country bounds'
  },
  // Minsk city center
  minskCenter: {
    ne: { lat: 53.92, lon: 27.58 },
    sw: { lat: 53.88, lon: 27.52 },
    description: 'Minsk city center area'
  },
  // Very small area (single block)
  singleBlock: {
    ne: { lat: 53.895, lon: 27.548 },
    sw: { lat: 53.893, lon: 27.546 },
    description: 'Single city block'
  }
};

export default {
  belarusCities,
  minskLocations,
  belarusBounds,
  invalidCoordinates,
  distanceScenarios,
  searchAreas,
  mapBounds
};
