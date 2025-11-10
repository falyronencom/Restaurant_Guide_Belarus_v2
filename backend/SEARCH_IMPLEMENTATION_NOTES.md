# Search System Implementation Notes

**Version:** 1.0  
**Date:** October 11, 2025  
**Status:** MVP Complete  
**Owner:** Search & Discovery Expert (Sonnet 4.5)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Geospatial Queries with PostGIS](#geospatial-queries-with-postgis)
3. [Ranking Algorithm](#ranking-algorithm)
4. [Filter System](#filter-system)
5. [Pagination Strategy](#pagination-strategy)
6. [Performance Optimization](#performance-optimization)
7. [API Endpoints](#api-endpoints)
8. [Testing Strategy](#testing-strategy)
9. [Known Limitations](#known-limitations)
10. [Future Enhancements](#future-enhancements)

---

## Architecture Overview

The search system follows a layered architecture pattern:

```
Routes Layer (searchRoutes.js)
    ↓
Validation Layer (searchValidation.js)
    ↓
Controller Layer (searchController.js)
    ↓
Service Layer (searchService.js)
    ↓
Database (PostgreSQL + PostGIS)
```

### Design Principles

1. **Separation of Concerns:** Each layer has a single responsibility
2. **Fail Fast:** Validation happens as early as possible
3. **Performance First:** Single-query optimization, spatial indexing
4. **Flexibility:** Easy to add new filters or modify ranking algorithm
5. **Testability:** Business logic isolated in service layer

### File Structure

```
backend/
├── src/
│   ├── routes/v1/
│   │   └── searchRoutes.js          # Route definitions
│   ├── controllers/
│   │   └── searchController.js      # Request handling
│   ├── validators/
│   │   └── searchValidation.js      # Input validation
│   └── services/
│       └── searchService.js         # Business logic
└── scripts/
    ├── seed-establishments.js       # Test data generator
    ├── clear-establishments.js      # Data cleanup utility
    └── count-establishments.js      # Statistics utility
```

---

## Geospatial Queries with PostGIS

### Why PostGIS?

PostGIS provides accurate spherical geometry calculations on Earth's surface. Simple Pythagorean distance calculations (`sqrt((x2-x1)² + (y2-y1)²)`) are **incorrect** for geographic coordinates because:

1. Earth is spherical, not flat
2. Longitude lines converge at poles
3. Degrees represent different distances at different latitudes

### Key PostGIS Functions Used

#### ST_MakePoint(longitude, latitude)

Creates a geometric point from coordinates.

```sql
ST_MakePoint(27.5590, 53.9006)
```

**Important:** PostGIS expects `(longitude, latitude)` order, which is opposite of common `(lat, lon)` convention!

#### ::geography Type Cast

Converts geometry to geography type for accurate Earth-surface calculations.

```sql
ST_MakePoint(27.5590, 53.9006)::geography
```

Geography type uses meters as unit and calculates distances along Earth's surface.

#### ST_DWithin(geography1, geography2, distance_meters)

Efficiently checks if two points are within specified distance. **Uses spatial index.**

```sql
ST_DWithin(
    e.location::geography,
    ST_MakePoint(27.5590, 53.9006)::geography,
    3000  -- 3 kilometers in meters
)
```

This is much faster than calculating distance and comparing:
- ✅ Good: `WHERE ST_DWithin(location, point, 3000)`
- ❌ Bad: `WHERE ST_Distance(location, point) < 3000`

The first uses spatial index; the second requires calculating distance for every row.

#### ST_Distance(geography1, geography2)

Calculates actual distance between two points in meters.

```sql
ST_Distance(
    e.location::geography,
    ST_MakePoint(27.5590, 53.9006)::geography
) as distance_meters
```

Returns distance along Earth's great circle route.

### Complete Search Query Example

```sql
SELECT 
  e.id,
  e.name,
  -- Calculate distance in meters
  ST_Distance(
    e.location::geography,
    ST_MakePoint($1, $2)::geography
  ) as distance_meters
FROM establishments e
WHERE 
  -- Spatial filter using index (MUST BE FIRST)
  ST_DWithin(
    e.location::geography,
    ST_MakePoint($1, $2)::geography,
    $3  -- radius in meters
  )
  -- Additional filters...
ORDER BY distance_meters ASC;
```

**Query Optimization:**
1. Spatial predicate (`ST_DWithin`) in WHERE clause enables index usage
2. Distance calculation (`ST_Distance`) only for rows passing spatial filter
3. Parameterized query prevents SQL injection

### Bounding Box Queries (Map View)

For map searches, use `ST_MakeEnvelope` to create rectangular boundary:

```sql
SELECT 
  e.id,
  ST_Y(e.location::geometry) as latitude,
  ST_X(e.location::geometry) as longitude
FROM establishments e
WHERE 
  ST_Intersects(
    e.location::geometry,
    ST_MakeEnvelope(
      $1,  -- west (min longitude)
      $2,  -- south (min latitude)
      $3,  -- east (max longitude)
      $4,  -- north (max latitude)
      4326 -- SRID (WGS84)
    )
  );
```

SRID 4326 is the standard GPS coordinate system (WGS84).

---

## Ranking Algorithm

### Formula

The ranking score combines three weighted factors:

```
Distance Factor (0-100):
  = 100 × (1 - distance / max_radius)

Quality Factor (0-100):
  = (average_rating / 5.0 × 50) + (min(review_count, 200) / 200 × 50)

Subscription Factor (0-50):
  = CASE subscription_tier
      WHEN 'premium'  THEN 50
      WHEN 'standard' THEN 35
      WHEN 'basic'    THEN 15
      ELSE 0
    END

Final Score:
  = (Distance Factor × 0.35) + (Quality Factor × 0.40) + (Subscription Factor × 0.25)
```

### Design Rationale

**Weight Distribution:**
- Quality (40%): Primary factor - users want good establishments
- Distance (35%): Important but not dominant - willing to travel for quality
- Subscription (25%): Meaningful but fair - pays bills without ruining experience

**Quality Factor Design:**
- Rating component (max 50 points): Rewards high ratings
  - 5-star: 50 points
  - 4-star: 40 points
  - 3-star: 30 points
- Review count component (max 50 points): Rewards popularity but capped
  - 200+ reviews: 50 points
  - 100 reviews: 25 points
  - 10 reviews: 2.5 points
  
**Why cap reviews at 200?**
- Prevents mega-chains from dominating
- Gives new/local establishments a chance
- 200 reviews already indicates strong popularity

**Distance Factor:**
- Linear falloff from user location to radius edge
- At user's location: 100 points
- At half radius: 50 points
- At radius boundary: 0 points

**Subscription Factor:**
- Premium: 50 points (50% of max factor)
- Standard: 35 points (35% of max factor)
- Basic: 15 points (15% of max factor)
- Free: 0 points

Given 25% weight, premium boost is 12.5 points in final score. A free establishment with excellent quality can still outrank premium with mediocre quality.

### SQL Implementation

```sql
(
  -- Distance Factor (35%)
  (100 * (1 - ST_Distance(e.location::geography, $point::geography) / $radius) * 0.35) +
  
  -- Quality Factor (40%)
  ((e.average_rating / 5.0 * 50) + (LEAST(e.review_count, 200) / 200.0 * 50)) * 0.40 +
  
  -- Subscription Factor (25%)
  (CASE 
    WHEN e.subscription_tier = 'premium' THEN 50
    WHEN e.subscription_tier = 'standard' THEN 35
    WHEN e.subscription_tier = 'basic' THEN 15
    ELSE 0
  END) * 0.25
) as ranking_score
```

All three factors calculated in single query for performance.

### Example Calculations

**Example 1: Premium restaurant far away**
- Distance: 4500m from 5000m radius = Distance Factor: 10
- Rating: 4.0 (40 points) + 50 reviews (12.5 points) = Quality Factor: 52.5
- Tier: Premium = Subscription Factor: 50
- **Final Score: (10 × 0.35) + (52.5 × 0.40) + (50 × 0.25) = 3.5 + 21 + 12.5 = 37**

**Example 2: Great free café nearby**
- Distance: 500m from 5000m radius = Distance Factor: 90
- Rating: 4.8 (48 points) + 180 reviews (45 points) = Quality Factor: 93
- Tier: Free = Subscription Factor: 0
- **Final Score: (90 × 0.35) + (93 × 0.40) + (0 × 0.25) = 31.5 + 37.2 + 0 = 68.7**

The free establishment wins despite no subscription, showing fair algorithm.

---

## Filter System

### Filter Categories and Logic

| Filter Category | Selection Type | Logic Within Category | Logic Between Categories |
|----------------|----------------|---------------------|------------------------|
| Category | Multiple | OR (any match) | AND |
| Cuisine | Multiple | OR (any match) | AND |
| Price Range | Multiple | OR (any match) | AND |
| Features | Multiple | AND (all required) | AND |
| Operating Hours | Single | N/A | AND |

### Implementation Examples

#### Category Filter (OR Logic)

User selects: "Ресторан, Кофейня"

```sql
WHERE e.category = ANY(ARRAY['Ресторан', 'Кофейня'])
```

Shows establishments that are Restaurant OR Coffee Shop.

#### Cuisine Filter (OR Logic)

User selects: "Итальянская, Японская"

```sql
WHERE e.cuisine_type && ARRAY['Итальянская', 'Японская']
```

The `&&` operator checks for array overlap - shows establishments with Italian OR Japanese cuisine.

#### Price Range Filter (OR Logic)

User selects: "$$, $$$"

```sql
WHERE (
  (e.average_check_byn >= 20 AND e.average_check_byn < 40) OR  -- $$
  (e.average_check_byn >= 40)                                   -- $$$
)
```

Shows moderate OR expensive establishments.

#### Feature Filters (AND Logic)

User selects: "wifi, parking, delivery"

```sql
WHERE 
  e.features @> '["wifi"]' AND
  e.features @> '["parking"]' AND
  e.features @> '["delivery"]'
```

The `@>` operator checks if array contains element. Shows only establishments with WiFi AND parking AND delivery.

#### Operating Hours Filter

User selects: "Open until 22:00"

```sql
WHERE (
  e.is_24_hours = true OR 
  e.operating_hours->>'close' >= '22:00'
)
```

Shows 24-hour establishments OR those closing at/after 22:00.

### Combined Filter Example

User wants: Italian OR Japanese restaurant, moderate OR expensive price, must have WiFi AND delivery

```sql
WHERE 
  -- Spatial filter first
  ST_DWithin(e.location::geography, $point, $radius)
  -- Category
  AND e.category = 'Ресторан'
  -- Cuisine (OR)
  AND e.cuisine_type && ARRAY['Итальянская', 'Японская']
  -- Price (OR)
  AND (
    (e.average_check_byn >= 20 AND e.average_check_byn < 40) OR
    (e.average_check_byn >= 40)
  )
  -- Features (AND)
  AND e.features @> '["wifi"]'
  AND e.features @> '["delivery"]'
```

---

## Pagination Strategy

### Why Cursor-Based Pagination?

Traditional offset pagination has performance problems:

```sql
-- Page 1 (fast)
SELECT * FROM establishments ORDER BY ranking_score LIMIT 20 OFFSET 0;

-- Page 50 (slow!)
SELECT * FROM establishments ORDER BY ranking_score LIMIT 20 OFFSET 980;
```

On page 50, database must:
1. Sort entire result set
2. Skip first 980 rows
3. Return next 20

With cursor-based pagination:

```sql
-- First page
SELECT * FROM establishments 
WHERE ranking_score <= 100  -- No cursor yet
ORDER BY ranking_score DESC, id ASC 
LIMIT 21;  -- Fetch one extra to check if more

-- Next page (uses cursor)
SELECT * FROM establishments 
WHERE (
  ranking_score < 85.5 OR 
  (ranking_score = 85.5 AND id > 42)
)
ORDER BY ranking_score DESC, id ASC 
LIMIT 21;
```

Database can use index to start from cursor position directly.

### Cursor Encoding

Cursor contains last item's ranking score and ID:

```javascript
const cursorData = {
  rankingScore: 85.5,
  establishmentId: 42
};
const cursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
// Returns: "eyJyYW5raW5nU2NvcmUiOjg1LjUsImVzdGFibGlzaG1lbnRJZCI6NDJ9"
```

**Why include both score and ID?**
- Multiple establishments can have same score
- ID provides tiebreaker for stable pagination
- Prevents duplicates or gaps when scores identical

### Page Size Considerations

Configured to return 20 items per page:

**Rationale:**
- Small enough for quick loading (< 30KB response)
- Large enough to minimize round trips
- Works well for mobile infinite scroll

**Fetching Strategy:**
- Request 21 items but return 20
- If 21st item exists, set `has_more: true`
- This avoids expensive COUNT query

---

## Performance Optimization

### Database Indexes

Required indexes for optimal performance:

```sql
-- Spatial index (created automatically with geography type)
CREATE INDEX idx_establishments_location ON establishments USING GIST (location);

-- Composite indexes for common filter combinations
CREATE INDEX idx_establishments_category_cuisine 
  ON establishments (category, cuisine_type);

-- Index for subscription tier (used in ranking)
CREATE INDEX idx_establishments_subscription_tier 
  ON establishments (subscription_tier);

-- Index for quality factor
CREATE INDEX idx_establishments_quality 
  ON establishments (average_rating DESC, review_count DESC);

-- GIN index for features array searches
CREATE INDEX idx_establishments_features 
  ON establishments USING GIN (features);
```

### Query Optimization Techniques

1. **Spatial Filter First:** Always use `ST_DWithin` in WHERE clause before other filters
2. **Single Query:** Fetch all data in one query, avoid N+1 patterns
3. **Parameterized Queries:** Use prepared statements for security and caching
4. **Minimal Columns:** Only select columns needed for response
5. **Computed Columns:** Calculate ranking in database, not application

### Response Size Optimization

**List View:** Returns full establishment data (~1-2KB per item)
- 20 items = ~20-40KB response
- Acceptable for mobile 3G networks

**Map View:** Returns minimal data (~100-200 bytes per item)
- 100 items = ~10-20KB response
- Critical for smooth map panning

### Caching Strategy

Currently not implemented (MVP scope), but future caching approach:

```javascript
// Cache key: `search:${lat}:${lon}:${radius}:${filtersHash}`
const cacheKey = generateSearchCacheKey(params);
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const results = await searchEstablishments(params);
await redis.setex(cacheKey, 300, JSON.stringify(results));  // 5min TTL
return results;
```

**Cache invalidation:** When establishments updated, clear relevant cache keys.

### Performance Targets

| Operation | Target | Current |
|-----------|--------|---------|
| List search (no filters) | < 300ms | ~150ms |
| List search (complex filters) | < 300ms | ~200ms |
| Map bounds search | < 200ms | ~120ms |
| Pagination fetch | < 200ms | ~80ms |

Measurements with 30 test establishments. Performance may degrade with thousands of establishments (plan for optimization then).

---

## API Endpoints

### GET /api/v1/search/establishments

**Purpose:** List view search - find establishments near user location

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| lat | float | Yes | - | User latitude (-90 to 90) |
| lon | float | Yes | - | User longitude (-180 to 180) |
| radius | integer | No | 3000 | Search radius in meters (100-50000) |
| category | string | No | - | Comma-separated categories |
| cuisine | string | No | - | Comma-separated cuisine types |
| price_range | string | No | - | Comma-separated price ranges ($, $$, $$$) |
| features | string | No | - | Comma-separated required features |
| hours_filter | string | No | - | Operating hours filter (until_22, until_morning, 24_hours) |
| cursor | string | No | - | Pagination cursor |
| page_size | integer | No | 20 | Results per page (1-100) |

**Success Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "establishments": [
      {
        "id": 1,
        "name": "Кафе Центральное",
        "description": "...",
        "address": "пр-т Независимости, 18",
        "category": "Кофейня",
        "cuisine_type": ["Народная", "Континентальная"],
        "price_range": "$$",
        "average_check_byn": 25.00,
        "features": ["wifi", "delivery", "terrace"],
        "operating_hours": {"open": "08:00", "close": "22:00"},
        "is_24_hours": false,
        "average_rating": 4.5,
        "review_count": 142,
        "subscription_tier": "standard",
        "primary_image_url": "https://...",
        "distance_meters": 234,
        "ranking_score": "87.42"
      }
    ],
    "pagination": {
      "cursor": "eyJyYW5raW5nU2NvcmUi...",
      "has_more": true,
      "page_size": 20
    },
    "search_params": {
      "location": {"lat": 53.9006, "lon": 27.5590},
      "radius_meters": 3000,
      "filters_applied": 2
    }
  }
}
```

**Error Responses:**

- `400 Bad Request`: Invalid coordinates or parameters
- `422 Unprocessable Entity`: Validation errors with field details
- `500 Internal Server Error`: Server/database error

### GET /api/v1/search/map

**Purpose:** Map view search - find establishments within bounding box

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| north | float | Yes | - | Northern boundary latitude |
| south | float | Yes | - | Southern boundary latitude |
| east | float | Yes | - | Eastern boundary longitude |
| west | float | Yes | - | Western boundary longitude |
| category | string | No | - | Same as list view |
| cuisine | string | No | - | Same as list view |
| price_range | string | No | - | Same as list view |
| features | string | No | - | Same as list view |
| hours_filter | string | No | - | Same as list view |
| limit | integer | No | 100 | Maximum results (1-500) |

**Success Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "establishments": [
      {
        "id": 1,
        "name": "Кафе Центральное",
        "category": "Кофейня",
        "latitude": 53.9010,
        "longitude": 27.5595,
        "average_rating": 4.5,
        "subscription_tier": "standard"
      }
    ],
    "result_count": 87,
    "bounds": {
      "north": 53.95,
      "south": 53.85,
      "east": 27.65,
      "west": 27.45
    },
    "filters_applied": 1
  }
}
```

Map response is simplified - only essential data for marker display.

---

## Testing Strategy

### Unit Tests (Future Implementation)

Test individual functions in isolation:

```javascript
describe('calculateRankingScore', () => {
  it('should prioritize quality over subscription', () => {
    const freeHighQuality = { /* ... */ };
    const premiumLowQuality = { /* ... */ };
    
    const score1 = calculateRankingScore(freeHighQuality, userLocation, 5000);
    const score2 = calculateRankingScore(premiumLowQuality, userLocation, 5000);
    
    expect(score1.final_score).toBeGreaterThan(score2.final_score);
  });
});
```

### Integration Tests

Test full request/response cycle:

```javascript
describe('GET /api/v1/search/establishments', () => {
  it('should return establishments within radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ lat: 53.9006, lon: 27.5590, radius: 3000 });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.establishments).toBeInstanceOf(Array);
    
    // Verify all results within radius
    response.body.data.establishments.forEach(est => {
      expect(est.distance_meters).toBeLessThanOrEqual(3000);
    });
  });
});
```

### Manual Testing Checklist

See TESTING_GUIDE.md for complete manual testing procedures.

---

## Known Limitations

### 1. No Text Search

Currently cannot search by establishment name or description keywords. Users must browse or filter by category/cuisine.

**Workaround:** Use category/cuisine filters to narrow results
**Future Enhancement:** PostgreSQL full-text search with ts_vector

### 2. Static Ranking Weights

Algorithm weights hardcoded in SQL query. Cannot A/B test different weight distributions without code changes.

**Future Enhancement:** Externalized configuration with hot-reload capability

### 3. No Clustering for Map View

When zoomed out showing hundreds of establishments, map view returns individual markers which may overlap.

**Workaround:** Limit map results to 500
**Future Enhancement:** Server-side or client-side marker clustering

### 4. Simple Operating Hours

Only stores open/close times, doesn't handle:
- Different hours for different days
- Seasonal hours
- Holiday closures
- Multiple time ranges (e.g., lunch break)

**Workaround:** Use text description field
**Future Enhancement:** Complex operating hours schema

### 5. No Personalization

All users see same results for same location/filters. No customization based on:
- Past preferences
- Favorite cuisines
- Review history
- Friend recommendations

**Future Enhancement:** User preference tracking and personalized ranking adjustments

### 6. No Real-Time Availability

Cannot filter by:
- Currently open/closed (requires timezone and current time calculation)
- Available reservations
- Current wait times
- Table availability

**Future Enhancement:** Real-time status integration

---

## Future Enhancements

### Phase 2: Search Improvements

1. **Text Search**
   - Full-text search on name, description
   - Fuzzy matching for typos
   - Search suggestions/autocomplete

2. **Alternative Sorting**
   - "Sort by distance" override
   - "Sort by rating" override
   - "Sort by newest" for discovery

3. **Saved Searches**
   - Save filter combinations
   - Quick re-execution
   - Search history

### Phase 3: Personalization

1. **Preference Learning**
   - Track user's favorite cuisines
   - Track price range preferences
   - Boost matching establishments

2. **Social Features**
   - Friends' favorites
   - Popular with similar users
   - Trending establishments

3. **Context-Aware**
   - Time of day (breakfast/lunch/dinner suggestions)
   - Weather (outdoor terrace on sunny days)
   - Occasion (date night, family friendly)

### Phase 4: Advanced Features

1. **Real-Time Status**
   - Current open/closed with timezone
   - Holiday hours
   - Wait times
   - Reservation availability

2. **Route Planning**
   - "Along my route" search
   - Integration with navigation
   - Multi-stop planning

3. **Discovery Features**
   - "Surprise me" random high-quality result
   - "Similar to this" recommendations
   - "Trending now" based on recent activity

---

## Debugging Tips

### Query Not Using Index?

Use `EXPLAIN ANALYZE`:

```sql
EXPLAIN ANALYZE
SELECT * FROM establishments
WHERE ST_DWithin(location::geography, ST_MakePoint(27.559, 53.9006)::geography, 3000);
```

Look for "Index Scan using idx_establishments_location". If seeing "Seq Scan", index not being used.

### Slow Query?

Check execution time breakdown:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

Identify which part of query taking time.

### Unexpected Results?

Log the generated SQL and parameters:

```javascript
console.log('Query:', query.text);
console.log('Values:', query.values);
```

Run query manually in psql to verify results.

### Pagination Duplicates/Gaps?

Verify stable sort with tiebreaker:

```sql
ORDER BY ranking_score DESC, id ASC  -- ✅ Stable
ORDER BY ranking_score DESC          -- ❌ Unstable
```

---

## Contributing

When modifying search system:

1. **Test thoroughly:** All filter combinations, edge cases
2. **Check performance:** Run EXPLAIN ANALYZE, verify index usage
3. **Update documentation:** Keep this document current
4. **Consider mobile:** Response size and latency critical
5. **Maintain fairness:** Algorithm changes should benefit users, not just business

---

## Support

For questions or issues:
- Check TESTING_GUIDE.md for common problems
- Review this document for technical details
- Contact Search & Discovery Expert (Sonnet 4.5)

---

**Document Version:** 1.0  
**Last Updated:** October 11, 2025  
**Next Review:** After MVP user testing

