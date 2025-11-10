# Architecture Updates - Search System Integration

**Date:** October 11, 2025  
**Version:** 2.0  
**Component:** Search & Discovery System

---

## Overview

This document describes how the Search & Discovery system integrates with the existing Restaurant Guide Belarus architecture. Add this section to the main ARCHITECTURE.md file.

---

## Search System Architecture

### High-Level Integration

```
┌─────────────────────────────────────────────────────────────┐
│                     Flutter Mobile App                       │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS/REST API
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Express.js API Server (Port 3000)               │
├─────────────────────────────────────────────────────────────┤
│  Middleware Stack:                                           │
│  ├─ CORS                                                     │
│  ├─ Helmet (Security)                                        │
│  ├─ Compression                                              │
│  ├─ Rate Limiting (Redis-backed)                             │
│  └─ Authentication (Optional for search)                     │
├─────────────────────────────────────────────────────────────┤
│  Routes:                                                     │
│  ├─ /api/v1/auth/*          (Authentication endpoints)      │
│  ├─ /api/v1/search/*        (Search endpoints) ← NEW        │
│  └─ /api/v1/establishments/* (CRUD endpoints) [future]      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         PostgreSQL 15.8 with PostGIS Extension               │
├─────────────────────────────────────────────────────────────┤
│  Tables:                                                     │
│  ├─ users                                                    │
│  ├─ establishments ← Core table for search                   │
│  ├─ reviews [future]                                         │
│  └─ favorites [future]                                       │
├─────────────────────────────────────────────────────────────┤
│  Indexes:                                                    │
│  ├─ idx_establishments_location (GIST - spatial)             │
│  ├─ idx_establishments_category_cuisine (B-tree)             │
│  ├─ idx_establishments_features (GIN - array)                │
│  └─ idx_establishments_quality (B-tree)                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis (Optional)                          │
│  - Search result caching                                     │
│  - Rate limiting counters                                    │
│  - Session storage                                           │
└─────────────────────────────────────────────────────────────┘
```

### Search System Components

```
/api/v1/search/
├─ establishments (GET)
│  └─ List view: radius-based search near user
│
└─ map (GET)
   └─ Map view: bounding box search for exploration
```

### Layer Architecture

```
searchRoutes.js (Routes Layer)
    │
    ├─> validateListSearch (Validation Middleware)
    │   └─> handleValidationErrors
    │
    ├─> authenticate (Optional Auth Middleware)
    │
    ├─> rateLimiter (Rate Limiting Middleware)
    │
    └─> searchController.listSearch (Controller)
            │
            └─> searchService.searchEstablishments (Service)
                    │
                    └─> PostgreSQL + PostGIS (Database)
```

---

## Database Schema Integration

### Establishments Table

The `establishments` table is the core entity for search functionality:

```sql
CREATE TABLE establishments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  address VARCHAR(500) NOT NULL,
  
  -- Geospatial column (PostGIS)
  location GEOGRAPHY(Point, 4326) NOT NULL,
  
  -- Search filters
  category VARCHAR(50) NOT NULL,
  cuisine_type TEXT[] DEFAULT '{}',
  price_range VARCHAR(10),
  average_check_byn DECIMAL(10,2),
  features TEXT[] DEFAULT '{}',
  
  -- Operating hours
  operating_hours JSONB,
  is_24_hours BOOLEAN DEFAULT false,
  
  -- Quality metrics (for ranking algorithm)
  average_rating DECIMAL(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  
  -- Subscription/business model
  subscription_tier VARCHAR(20) DEFAULT 'free',
  
  -- Images
  primary_image_url TEXT,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Critical indexes for search performance
CREATE INDEX idx_establishments_location 
  ON establishments USING GIST (location);

CREATE INDEX idx_establishments_category_cuisine 
  ON establishments (category, cuisine_type);

CREATE INDEX idx_establishments_features 
  ON establishments USING GIN (features);
```

### Dependencies on Other Tables

**Current:** None - search is completely independent

**Future dependencies:**
- `reviews` table: Aggregate ratings/counts for quality factor
- `favorites` table: Boost establishments user favorited (personalization)
- `view_history` table: Track what users search/view for analytics

---

## API Endpoint Specifications

### Endpoint 1: List View Search

```
GET /api/v1/search/establishments
```

**Purpose:** Find establishments near user's current location

**Authentication:** Optional (public search allowed)

**Rate Limit:** 100 requests/minute per IP

**Query Parameters:**

| Parameter | Type | Required | Validation | Example |
|-----------|------|----------|------------|---------|
| lat | float | Yes | -90 to 90 | 53.9006 |
| lon | float | Yes | -180 to 180 | 27.5590 |
| radius | int | No | 100-50000 | 3000 |
| category | string | No | Valid categories | Ресторан,Кофейня |
| cuisine | string | No | Valid cuisines | Итальянская |
| price_range | string | No | $, $$, $$$ | $$,$$$ |
| features | string | No | Valid features | wifi,parking |
| hours_filter | string | No | until_22, until_morning, 24_hours | until_22 |
| cursor | string | No | Base64 string | eyJyYW5raW5... |
| page_size | int | No | 1-100 | 20 |

**Response Time Target:** < 300ms

**Response Format:**

```json
{
  "success": true,
  "data": {
    "establishments": [/* array of establishments */],
    "pagination": {
      "cursor": "eyJyYW5raW5...",
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

### Endpoint 2: Map View Search

```
GET /api/v1/search/map
```

**Purpose:** Find establishments within map viewport

**Query Parameters:** Similar to list view but uses bounding box (north, south, east, west) instead of radius

**Response Time Target:** < 200ms

**Response Format:** Simplified - only essential data for map markers

---

## PostGIS Integration

### Why PostGIS?

PostGIS provides accurate geospatial calculations on Earth's spherical surface. Standard Euclidean distance calculations are inaccurate for geographic coordinates.

### Key Functions Used

| Function | Purpose | Example |
|----------|---------|---------|
| ST_MakePoint | Create point from coordinates | ST_MakePoint(27.559, 53.9006) |
| ST_Distance | Calculate distance in meters | ST_Distance(point1::geography, point2::geography) |
| ST_DWithin | Check if within radius (indexed) | ST_DWithin(location, point, 3000) |
| ST_MakeEnvelope | Create bounding box | ST_MakeEnvelope(west, south, east, north, 4326) |
| ST_Intersects | Check if point in box | ST_Intersects(location, envelope) |

### Geography vs Geometry

- **Geography:** Spherical calculations on Earth surface, distances in meters
- **Geometry:** Planar calculations, faster but less accurate for large distances

We use `geography` type for accuracy despite slight performance cost.

### SRID 4326

SRID (Spatial Reference ID) 4326 is WGS84 - the standard GPS coordinate system. All location data uses this SRID for consistency.

---

## Ranking Algorithm Integration

### Business Logic

The ranking algorithm is core business logic implemented in SQL for performance:

```
Final Score = (Distance × 0.35) + (Quality × 0.40) + (Subscription × 0.25)
```

**Why SQL implementation?**
- Single database query (no N+1 problem)
- Leverages database indexes
- Reduces data transfer (only top results)
- Easier to optimize with EXPLAIN ANALYZE

### Algorithm Transparency

Ranking score returned to client for:
- Debugging during development
- User trust (understanding why results ordered)
- Future A/B testing different weights

In production, consider removing `ranking_score` from response to prevent reverse-engineering and gaming the system.

---

## Performance Considerations

### Database Query Optimization

1. **Spatial Predicate First:** `ST_DWithin` in WHERE clause enables index usage
2. **Single Query:** All filtering and ranking in one SQL statement
3. **Pagination:** Cursor-based to avoid offset performance degradation
4. **Index Coverage:** Indexes for spatial, categorical, and array searches

### Response Size Optimization

| View | Data per Item | 20 Items | 100 Items |
|------|---------------|----------|-----------|
| List | ~1-2KB | ~20-40KB | ~100-200KB |
| Map | ~100-200 bytes | ~2-4KB | ~10-20KB |

Map view heavily optimized for smooth panning experience.

### Caching Strategy (Future)

```javascript
// Cache key structure
const cacheKey = `search:${gridCellId}:${filtersHash}`;

// Grid-based caching reduces key space
// Round coordinates to nearest 0.01 degree (~1km grid)
const gridCellId = `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
```

**Cache Invalidation:** When establishment updated, invalidate grid cells it appears in.

---

## Security Considerations

### Input Validation

All input strictly validated by express-validator middleware:
- Coordinate ranges (-90 to 90 latitude, -180 to 180 longitude)
- Reasonable radius (100m to 50km)
- Whitelisted filter values (prevent SQL injection)
- Pagination cursor format validation

### SQL Injection Prevention

All queries use parameterized statements:

```javascript
// ✅ Safe - parameterized
pool.query('SELECT * FROM establishments WHERE id = $1', [userId]);

// ❌ Dangerous - string concatenation
pool.query(`SELECT * FROM establishments WHERE id = ${userId}`);
```

### Rate Limiting

Search endpoints protected by rate limiting:
- 100 requests/minute per authenticated user
- 300 requests/hour per IP for unauthenticated users

Prevents abuse and DoS attacks.

### Authentication

Search endpoints support **optional authentication**:
- Unauthenticated: Public search for discovery
- Authenticated: May receive personalized results (future)

This allows app to be useful before user signs up.

---

## Monitoring and Logging

### Key Metrics to Track

1. **Performance Metrics:**
   - Average query time by endpoint
   - 95th percentile query time
   - Slow query log (> 1 second)

2. **Usage Metrics:**
   - Searches per day/hour
   - Most common filter combinations
   - Average results per search
   - Pagination depth (how far users scroll)

3. **Business Metrics:**
   - Establishments clicked from search
   - Conversion rate (search → view → favorite/review)
   - Filter usage frequency

### Logging Structure

```javascript
{
  "timestamp": "2025-10-11T10:30:45Z",
  "event": "search_performed",
  "user_id": "user_123",
  "coordinates": [53.9006, 27.5590],
  "radius": 3000,
  "filters": ["category:Ресторан", "features:wifi"],
  "results_count": 15,
  "query_time_ms": 145,
  "client_version": "2.0.0"
}
```

---

## Testing Infrastructure

### Test Data

30 strategically designed establishments for testing:
- **Geographic distribution:** Clusters at 500m, 1km, 3km, 5km, 10km
- **Rating diversity:** 3.5 to 4.9 stars
- **Review diversity:** 12 to 856 reviews
- **All categories:** Complete coverage
- **All subscription tiers:** Free to Premium

See `scripts/seed-establishments.js` for full dataset.

### Testing Scripts

```bash
# Add test data
npm run seed

# Check current data
npm run count
npm run count -- --detailed

# Clear all data
npm run clear-data

# Reset: clear and re-seed
npm run db:reset
```

### Manual Testing

See `TESTING_GUIDE.md` for comprehensive testing procedures including:
- Curl examples for all endpoints
- Postman collection instructions
- Expected results verification
- Filter combination testing

---

## Deployment Considerations

### Environment Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=restaurant_guide_belarus
DB_USER=postgres
DB_PASSWORD=secure_password

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
NODE_ENV=production

# Logging
LOG_LEVEL=info
```

### PostGIS Requirement

**Critical:** PostgreSQL must have PostGIS extension installed:

```sql
-- Check if installed
SELECT PostGIS_Version();

-- Install if needed
CREATE EXTENSION postgis;
```

### Database Indexes

Ensure all indexes created before production:

```bash
npm run migrate  # Runs migrations including index creation
```

### Health Check

Search system provides health check endpoint:

```bash
GET /api/v1/search/health
```

Returns 200 if database and PostGIS operational, 503 otherwise.

---

## Future Architecture Enhancements

### Phase 2: Caching Layer

```
Client → API Server → Redis Cache → PostgreSQL
                           ↑              ↓
                           └──────────────┘
                         Cache miss: query DB
```

### Phase 3: Read Replicas

```
Write Operations → Primary DB
                       ↓
                   Replication
                       ↓
Read Operations  → Replica DB (Search queries)
```

Offload search queries to read replica for better write performance.

### Phase 4: Elasticsearch Integration

For advanced text search and autocomplete:

```
PostgreSQL (Source of Truth)
     ↓
Change Data Capture (CDC)
     ↓
Elasticsearch (Text Search Index)
     ↓
Text Search API
```

---

## Integration Checklist

Before deploying search system:

- [ ] PostgreSQL 15.8+ with PostGIS installed
- [ ] Database schema migrated with indexes
- [ ] Test data seeded and verified
- [ ] Environment variables configured
- [ ] Rate limiting configured (Redis recommended)
- [ ] Search endpoints added to API routes
- [ ] Health check endpoint tested
- [ ] Manual API testing completed
- [ ] Performance testing passed (< 300ms target)
- [ ] Documentation reviewed by team

---

## Troubleshooting

### Common Issues

**1. "PostGIS not installed" error**

```sql
-- Install extension
CREATE EXTENSION postgis;

-- Verify
SELECT PostGIS_Version();
```

**2. Slow query performance**

```sql
-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM establishments WHERE ST_DWithin(...);

-- Should show "Index Scan using idx_establishments_location"
```

**3. No search results**

- Verify test data exists: `npm run count`
- Check radius (try larger value like 10000m)
- Verify coordinates are valid (latitude -90 to 90)

**4. Rate limit errors**

- Check Redis connection if using Redis-backed limiting
- Verify rate limit configuration in middleware

---

## Contact and Support

- **Search System Issues:** Review SEARCH_IMPLEMENTATION_NOTES.md
- **Testing Questions:** Review TESTING_GUIDE.md
- **Architecture Questions:** Review this document
- **Bug Reports:** Create issue in repository

---

**Document Version:** 1.0  
**Integration Date:** October 11, 2025  
**Next Review:** After MVP user testing

