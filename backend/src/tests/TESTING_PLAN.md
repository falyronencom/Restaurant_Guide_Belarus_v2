# Restaurant Guide v2 Backend - Comprehensive Testing Plan

**Created:** November 5, 2025
**QA Engineer:** Claude Code Testing Agent
**Phase:** Phase 1 - Exploration & Understanding (Complete)
**Status:** Ready to Execute

---

## Executive Summary

This document outlines the comprehensive testing strategy for the Restaurant Guide Belarus v2.0 backend. After thorough exploration, I've identified a **well-structured, production-ready codebase** of approximately 9,245 lines implementing five major systems through a clean layered architecture. The backend lacks any automated tests, presenting both a challenge and opportunity for comprehensive quality assurance.

**Critical Finding:** This is a sophisticated backend built through distributed AI development with excellent architectural patterns, but **zero test coverage**. Before the team invests months in Flutter mobile development, we need confidence that this foundation is solid.

---

## Project Discovery Summary

### Architecture Analysis

**Technology Stack:**
- Node.js 18+ with ES modules
- Express 4.18 with layered architecture
- PostgreSQL with PostGIS for geospatial queries
- Redis 4.6 for rate limiting and sessions
- Cloudinary for media storage
- Argon2id for password hashing
- JWT with refresh token rotation

**Code Structure:** ⭐ **Excellent**
```
backend/src/
├── config/           # Database, Redis, Cloudinary
├── controllers/      # 6 controllers (auth, establishment, review, favorite, media, health)
├── middleware/       # auth.js, rateLimiter.js, errorHandler.js
├── models/           # 4 models (establishment, review, favorite, media)
├── services/         # 5 services (auth, establishment, review, favorite, media)
├── routes/           # Versioned API (v1)
├── utils/            # jwt.js, logger.js
├── validators/       # Express-validator schemas
└── tests/            # EMPTY (only .gitkeep)
```

**Architecture Pattern:** Routes → Controllers → Services → Models
**Security:** JWT authentication, role-based authorization, rate limiting, Argon2id hashing
**Quality:** Comprehensive error handling, structured logging, parameterized queries

### Implemented Systems

✅ **1. Authentication System** (`authService.js` - 14,923 bytes)
- Email/phone registration with Argon2id hashing
- Login with JWT access + refresh tokens
- Refresh token rotation (strict security)
- Rate limiting for brute force prevention
- Belarus-specific phone validation (+375 format)
- OAuth integration (Google, Yandex) - implementation present

✅ **2. Establishments Management** (`establishmentService.js` - 18,893 bytes)
- Partner registration and CRUD operations
- Draft → Pending → Active → Suspended workflow
- Belarus-specific validation (7 cities, geographic bounds)
- Categories (13 types) and Cuisines (11 types) validation
- Ownership verification
- Tier-based limits (Free: 10+10, Premium: 30+30 media)
- Integration with media management

✅ **3. Search & Discovery** (embedded in `establishmentService.js`)
- PostGIS geospatial queries (radius and bounds-based)
- Multi-factor ranking: distance + rating + review_count + boost_score
- Filtering: categories, cuisines, price range, status
- Pagination with metadata
- Map view and list view endpoints

✅ **4. Reviews System** (`reviewService.js` - 17,748 bytes)
- Create/read/update/delete reviews
- One review per user per establishment constraint
- Daily quota enforcement (10 reviews/day)
- Rating aggregation and establishment metrics update
- Partner responses to reviews
- Soft deletion (marked as deleted but not removed)
- Review ownership verification

✅ **5. Favorites System** (`favoriteService.js` - 12,128 bytes)
- Add/remove favorites (idempotent operations)
- List with pagination and rich establishment details
- Batch status checking for multiple establishments
- User isolation (can't see others' favorites)
- Statistics endpoint

✅ **6. Media Management** (`mediaService.js` - 13,696 bytes)
- Cloudinary integration for upload/delete
- Image optimization (WebP conversion)
- Primary photo management
- Tier-based upload limits
- CASCADE deletion integration

---

## Testing Strategy

### Testing Approach

**Framework:** Jest (industry standard for Node.js)
**Test Database:** Separate test database with same schema
**Coverage Goal:** >75% overall, >90% for critical paths
**Test Types:** Integration tests + End-to-end tests

**Why Integration Tests?**
Given the layered architecture and database-centric operations, integration tests provide the most value. We'll test complete request flows (routes → controllers → services → models → database) rather than isolated unit tests. This mirrors real-world usage and catches integration issues.

### Test Environment Design

**Database Strategy:**
- Create `restaurant_guide_test` database
- Run migrations to match production schema
- Use transactions with rollback for test isolation
- Seed minimal fixtures before each test suite

**Redis Strategy:**
- Use Redis DB 1 for testing (separate from dev DB 0)
- Clear rate limit keys before each test suite
- Mock rate limiting for tests that don't specifically test it

**Cloudinary Strategy:**
- Mock Cloudinary SDK for most tests (faster)
- Create one E2E test with actual Cloudinary upload
- Use test Cloudinary account if available

**Authentication Strategy:**
- Helper functions to create test users and generate tokens
- Reusable fixtures for user, partner, admin roles
- Token validation helpers for testing auth middleware

---

## System-by-System Testing Plan

### 1. Authentication System Testing

**Priority:** CRITICAL - Everything depends on this
**Estimated Test Count:** 40-50 tests
**Time Estimate:** 1.5-2 hours

**Happy Path Tests:**
- User registration (email)
- User registration (phone)
- Login with email
- Login with phone
- Token refresh with valid refresh token
- Logout (token invalidation)
- Get current user profile (/auth/me)

**Security Tests:**
- Password hashing with Argon2id (verify hash format)
- Refresh token rotation (old token must be invalid after refresh)
- JWT expiration enforcement (access token 15m, refresh 30d)
- Rate limiting on login attempts (3 failed → rate limited)
- Invalid credentials rejection
- Missing token rejection (401)
- Expired token rejection (401)
- Malformed token rejection (401)

**Validation Tests:**
- Invalid email format rejection
- Invalid phone format rejection (must be +375...)
- Weak password rejection (min length, complexity)
- Missing required fields rejection
- Duplicate email registration (409 conflict)
- Duplicate phone registration (409 conflict)

**Edge Cases:**
- Email normalization (Test@Example.COM → test@example.com)
- Phone normalization (whitespace trimming)
- Name whitespace handling
- Concurrent login attempts
- Token refresh race conditions

**Belarus-Specific Tests:**
- Phone validation: +375291234567 ✅
- Phone validation: +375331234567 ✅ (all Belarus operators)
- Phone rejection: +7... ❌ (Russia)
- Phone rejection: +1... ❌ (USA)

**Expected Bugs to Find:**
- Race conditions in refresh token rotation
- Case sensitivity issues in email lookups
- Token invalidation not working correctly
- Rate limiting bypass vulnerabilities

---

### 2. Establishments Management Testing

**Priority:** HIGH - Core feature
**Estimated Test Count:** 60-70 tests
**Time Estimate:** 2-3 hours

**CRUD Operations:**
- Create establishment (draft status, partner authenticated)
- List partner's establishments (with pagination)
- Get establishment details by ID
- Update establishment (own establishment only)
- Submit for moderation (draft → pending)
- Cannot update establishment owned by different partner

**Belarus-Specific Validation:**
- Valid cities: Минск, Гродно, Брест, Гомель, Витебск, Могилев, Бобруйск ✅
- Invalid city: "Москва" ❌
- Coordinates within Belarus bounds (51-56°N, 23-33°E) ✅
- Coordinates outside Belarus ❌
- Test with Minsk center: 53.9°N, 27.5°E ✅

**Categories & Cuisines Validation:**
- Valid categories: Ресторан, Кофейня, Бар (13 total)
- Categories array: 1-2 items ✅
- Categories array: 0 items ❌
- Categories array: 3 items ❌
- Invalid category: "Burger Joint" ❌
- Valid cuisines: Белорусская, Итальянская, Японская (11 total)
- Cuisines array: 1-3 items ✅
- Cuisines array: 0 items ❌
- Invalid cuisine: "Mexican" ❌

**Status Workflow:**
- New establishment starts as 'draft'
- Can submit draft → pending
- Cannot submit pending again
- Major update on active → resets to pending
- Admin can approve (would need admin endpoint)

**Ownership & Authorization:**
- Partner can list only their establishments
- Partner can update only their establishments
- Partner cannot update other partner's establishment (403)
- Regular user cannot create establishment (403)
- Unauthenticated request rejected (401)

**Integration with Media:**
- Create establishment → can add media
- Media count respects tier limits
- Free tier: max 10 photos + 10 menu photos
- Premium tier: max 30 photos + 30 menu photos

**Edge Cases:**
- Duplicate name for same partner (should succeed or fail?)
- Empty description (allowed or required?)
- Missing optional fields (website, email)
- Very long description (9MB would crash?)
- Concurrent updates to same establishment

**Expected Bugs to Find:**
- Status transition logic errors
- Ownership verification bypasses
- Geographic bounds not enforced
- Category/cuisine validation allowing invalid values
- Pagination edge cases

---

### 3. Search & Discovery Testing

**Priority:** HIGH - Complex PostGIS queries
**Estimated Test Count:** 50-60 tests
**Time Estimate:** 2-3 hours

**Geospatial Queries:**
- Radius search centered on Minsk (53.9°N, 27.5°E)
  - 1km radius
  - 5km radius
  - 10km radius
  - 50km radius
- Bounds search (map view)
  - Northeast and Southwest corners
  - Very large bounds (entire country)
  - Very small bounds (single block)
- Distance calculation accuracy (PostGIS ST_Distance)

**Filtering:**
- Filter by single category: "Ресторан"
- Filter by multiple categories: ["Ресторан", "Кофейня"]
- Filter by single cuisine: "Итальянская"
- Filter by multiple cuisines: ["Итальянская", "Японская"]
- Filter by price range: "$$" (2 of 4)
- Filter by minimum rating: 4.0+
- Combined filters: category + cuisine + price + rating
- Filter by status: 'active' (public view)
- No status filter (partner view - sees all own establishments)

**Ranking Algorithm:**
- Test weighted ranking formula:
  - Distance weight (closer = higher rank)
  - Rating weight (higher rating = higher rank)
  - Review count weight (more reviews = higher rank)
  - Boost score (paid promotion)
- Verify results ordered correctly by composite score

**Pagination:**
- Page 1 with limit 10
- Page 2 with limit 10
- Very large page number (beyond results)
- limit=1 (minimum)
- limit=100 (maximum allowed?)
- hasNext and hasPrevious flags accuracy
- Total count accuracy

**Edge Cases:**
- Search with no results (returns empty array)
- Search outside Belarus (no results)
- Search with invalid coordinates
- Establishments with NULL rating (no reviews yet)
- Performance with 1000+ establishments

**Realistic Test Data:**
- Seed establishments in Minsk (53.9°N, 27.5°E)
- Seed establishments in Гомель (52.4°N, 31.0°E)
- Seed establishments in Брест (52.1°N, 23.7°E)
- Realistic names: "Васильки", "Гамбринус", "Кухмистр"
- Mix of categories and cuisines
- Range of ratings (1.0 to 5.0)

**Expected Bugs to Find:**
- PostGIS queries returning incorrect distances
- Ranking algorithm weighting errors
- Pagination metadata incorrect
- Geographic bounds not properly enforced
- Performance issues with complex filters

---

### 4. Reviews System Testing

**Priority:** HIGH - User-generated content
**Estimated Test Count:** 50-60 tests
**Time Estimate:** 2-2.5 hours

**CRUD Operations:**
- Create review (authenticated, rating 1-5, content)
- Read review by ID (public)
- List reviews for establishment (public, paginated)
- Update own review (authenticated, author only)
- Delete own review (authenticated, author only)
- Cannot update other user's review (403)
- Cannot delete other user's review (403)

**Business Rules:**
- One review per user per establishment (UNIQUE constraint)
- Attempting second review → 409 conflict
- Daily quota: 10 reviews per day per user
- Creating 11th review in same day → 429 rate limited
- Quota resets next day
- Rating must be 1-5 (inclusive)
- Rating 0 ❌
- Rating 6 ❌
- Rating 3.5 ❌ (must be integer)

**Establishment Metrics Update:**
- Create review → establishment.average_rating updates
- Create review → establishment.review_count increments
- Update review rating → average_rating recalculates
- Delete review → review_count decrements
- Delete review → average_rating recalculates
- Test with 1 review, 10 reviews, 100 reviews

**Partner Responses:**
- Partner can respond to reviews on their establishment
- Partner cannot respond to reviews on other's establishment
- Regular user cannot add partner response
- Response updates review.partner_response field

**Soft Deletion:**
- Deleted reviews remain in database (is_deleted=true)
- Deleted reviews not visible in lists
- Deleted reviews not visible by ID
- Metrics updated correctly on soft delete
- Cannot restore deleted review (or can we?)

**Validation:**
- Missing rating ❌
- Missing content ❌
- Empty content string ❌
- Content too long (e.g., 10,000 characters) - should work or limit?
- Invalid establishment_id ❌ (404)
- Review for non-existent establishment ❌

**Edge Cases:**
- Concurrent review creation (two requests simultaneously)
- Update review immediately after creation
- Delete review immediately after creation
- Quota enforcement across multiple API instances (Redis distributed)
- Very long Russian/Belarusian text with special characters
- Emoji in review content

**Expected Bugs to Find:**
- One-review-per-establishment constraint bypassed by race condition
- Daily quota not enforcing correctly (Redis key issues)
- Metrics update race conditions (multiple reviews created simultaneously)
- Partner response authorization issues
- Soft deletion not working (actual deletion happening)

---

### 5. Favorites System Testing

**Priority:** MEDIUM - Simpler feature
**Estimated Test Count:** 30-40 tests
**Time Estimate:** 1-1.5 hours

**CRUD Operations:**
- Add establishment to favorites (authenticated)
- Remove establishment from favorites (authenticated)
- List all favorites with pagination (authenticated)
- Check single establishment favorite status (authenticated)
- Batch check multiple establishments (authenticated)
- Get favorites statistics (authenticated)

**Idempotency:**
- Add already-favorited establishment → succeeds (no error)
- Remove already-removed favorite → succeeds (no error)
- Multiple add requests → only one favorite created
- Multiple remove requests → no errors

**User Isolation:**
- User A's favorites not visible to User B
- User A cannot remove User B's favorite
- Each user has independent favorites collection
- Batch check returns correct status per user

**Integration with Establishments:**
- Favorites include rich establishment details (name, address, rating)
- Favoriting deleted establishment → 404
- Establishment deletion cascades to favorites (CASCADE)
- Favorite list shows current establishment data

**Pagination:**
- Page 1 with limit 10
- Page 2 with limit 10
- Pagination metadata accuracy (total, hasNext, hasPrevious)
- Empty favorites list (new user)

**Batch Status Checking:**
- Check 1 establishment
- Check 10 establishments
- Check 50 establishments (max batch size?)
- Mixed favorited and non-favorited in batch
- Invalid establishment IDs in batch

**Edge Cases:**
- Favorite non-existent establishment (404)
- Remove non-existent favorite (succeeds due to idempotency)
- Very large favorites collection (100+ items)
- Concurrent add/remove operations
- Favorite and unfavorite rapidly

**Expected Bugs to Find:**
- User isolation bypasses
- Idempotency not working correctly
- Batch checking performance issues
- Cascade deletion not working
- Pagination edge cases

---

### 6. Media Management Testing

**Priority:** MEDIUM - Cloudinary integration
**Estimated Test Count:** 30-40 tests
**Time Estimate:** 1.5-2 hours

**Upload Operations:**
- Upload photo (partner authenticated, own establishment)
- Upload menu photo (partner authenticated, own establishment)
- Set primary photo
- Upload multiple photos sequentially
- Cannot upload to other partner's establishment (403)

**Tier-Based Limits:**
- Free tier: upload 10 photos ✅
- Free tier: upload 11th photo ❌ (403 quota exceeded)
- Free tier: upload 10 menu photos ✅
- Free tier: upload 11th menu photo ❌
- Premium tier: upload 30 photos ✅
- Premium tier: upload 31st photo ❌

**Cloudinary Integration:**
- Upload returns Cloudinary URL
- URL format: https://res.cloudinary.com/...
- Image optimizations applied (WebP format)
- Delete triggers Cloudinary deletion (public_id)

**Media Management:**
- Reorder photos (change display_order)
- Set/unset primary photo
- Delete photo (CASCADE to Cloudinary)
- List all media for establishment
- Filter by media_type: 'photo' or 'menu'

**Validation:**
- Invalid file type (not image) ❌
- File too large (>10MB?) ❌
- Missing establishment_id ❌
- Invalid media_type ❌

**Edge Cases:**
- Upload same image multiple times (allowed?)
- Delete primary photo (next photo becomes primary?)
- Delete all photos
- Concurrent uploads
- Cloudinary API failure handling

**Expected Bugs to Find:**
- Tier limits not enforced correctly
- Cloudinary deletion not triggered
- Primary photo logic errors
- Concurrent upload race conditions
- File validation bypasses

---

## End-to-End Testing Plan

**Priority:** HIGH - Validates complete workflows
**Estimated Test Count:** 10-15 scenarios
**Time Estimate:** 1.5-2 hours

### E2E Scenario 1: Complete User Journey
1. Register new user (email + password)
2. Login and receive tokens
3. Search for restaurants in Minsk (radius 5km)
4. Get details for one restaurant
5. Create review (5 stars, positive content)
6. Add restaurant to favorites
7. View favorites list (contains the restaurant)
8. Update review (change to 4 stars)
9. Remove from favorites
10. Logout (token invalidation)

### E2E Scenario 2: Complete Partner Journey
1. Register partner account
2. Login as partner
3. Create new establishment (draft status)
4. Add establishment details
5. Upload 3 photos
6. Set primary photo
7. Submit for moderation (draft → pending)
8. Update establishment info (pending → pending)
9. View own establishments list
10. Logout

### E2E Scenario 3: Heavy Usage Scenario
1. Create 10 different establishments (different locations)
2. Create 100 reviews across establishments
3. Create 50 favorites
4. Perform 50 searches with various filters
5. Verify all operations succeeded
6. Verify performance acceptable (<200ms per operation)

### E2E Scenario 4: Concurrent Users
1. Simulate 5 users simultaneously
2. Each user creates reviews, favorites, searches
3. Verify no data corruption
4. Verify rate limiting works across users
5. Verify user isolation maintained

### E2E Scenario 5: Error Recovery
1. Start operation (e.g., create review)
2. Simulate database failure mid-operation
3. Verify transaction rollback
4. Verify database consistent state
5. Retry operation successfully

---

## Test Infrastructure Design

### Directory Structure
```
backend/src/tests/
├── setup.js                      # Global test setup & teardown
├── teardown.js                   # Global cleanup
├── jest.config.js                # Jest configuration
├── fixtures/                     # Test data
│   ├── users.js                 # User fixtures (user, partner, admin)
│   ├── establishments.js        # Establishment fixtures
│   ├── reviews.js               # Review fixtures
│   └── coordinates.js           # Belarus city coordinates
├── utils/                        # Test helpers
│   ├── auth.js                  # generateToken(), createTestUser()
│   ├── api.js                   # makeRequest(), expectError()
│   ├── database.js              # clearDatabase(), seedDatabase()
│   └── assertions.js            # Custom assertions
├── integration/                  # Integration tests
│   ├── auth.test.js             # ~50 tests
│   ├── establishments.test.js   # ~70 tests
│   ├── search.test.js           # ~60 tests
│   ├── reviews.test.js          # ~60 tests
│   ├── favorites.test.js        # ~40 tests
│   └── media.test.js            # ~40 tests
├── e2e/                          # End-to-end tests
│   ├── user-journey.test.js     # Complete user workflows
│   ├── partner-journey.test.js  # Complete partner workflows
│   └── concurrent.test.js       # Concurrent operations
└── TESTING_PLAN.md               # This document
```

### Test Fixtures Design

**Users Fixture:**
```javascript
export const testUsers = {
  regularUser: {
    email: 'user@test.com',
    phone: '+375291234567',
    password: 'Test123!@#',
    name: 'Test User',
    role: 'user'
  },
  partner: {
    email: 'partner@test.com',
    phone: '+375331234567',
    password: 'Partner123!@#',
    name: 'Test Partner',
    role: 'partner'
  },
  admin: {
    email: 'admin@test.com',
    phone: '+375441234567',
    password: 'Admin123!@#',
    name: 'Test Admin',
    role: 'admin'
  }
};
```

**Establishments Fixture:**
```javascript
export const testEstablishments = [
  {
    name: 'Васильки',
    description: 'Традиционная белорусская кухня в центре Минска',
    city: 'Минск',
    address: 'пр. Независимости 47',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан'],
    cuisines: ['Народная'],
    price_range: '$$$'
  },
  {
    name: 'Гамбринус',
    description: 'Европейская кухня и пивоварня',
    city: 'Минск',
    address: 'ул. Притыцкого 156',
    latitude: 53.92,
    longitude: 27.48,
    categories: ['Ресторан', 'Бар'],
    cuisines: ['Европейская'],
    price_range: '$$'
  }
  // ... more fixtures with variety
];
```

**Coordinates Fixture:**
```javascript
export const belarusCities = {
  minsk: { lat: 53.9, lon: 27.5 },
  gomel: { lat: 52.4, lon: 31.0 },
  brest: { lat: 52.1, lon: 23.7 },
  grodno: { lat: 53.7, lon: 23.8 },
  vitebsk: { lat: 55.2, lon: 30.2 },
  mogilev: { lat: 53.9, lon: 30.3 },
  bobruisk: { lat: 53.1, lon: 29.2 }
};
```

### Helper Functions Design

**Auth Helper:**
```javascript
// Create test user and return token
export async function createUserAndGetToken(userData) {
  const user = await createTestUser(userData);
  const token = generateAccessToken(user);
  return { user, token };
}

// Generate valid JWT for testing
export function generateTestToken(userId, role = 'user') {
  // ...
}
```

**API Helper:**
```javascript
// Make authenticated request
export async function makeAuthenticatedRequest(method, path, token, data) {
  // ...
}

// Expect specific error
export function expectError(response, statusCode, errorCode) {
  expect(response.status).toBe(statusCode);
  expect(response.body.error.code).toBe(errorCode);
}
```

**Database Helper:**
```javascript
// Clear all test data
export async function clearDatabase() {
  await pool.query('TRUNCATE users CASCADE');
  await pool.query('TRUNCATE establishments CASCADE');
  // ...
}

// Seed minimal data
export async function seedDatabase() {
  // Insert fixtures
}
```

---

## Testing Tools & Configuration

### Jest Configuration
```javascript
// jest.config.js
export default {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  globalTeardown: '<rootDir>/tests/teardown.js',
  testMatch: ['**/*.test.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000, // 10 seconds per test
  maxWorkers: 1, // Sequential execution for database tests
};
```

### Test Database Setup
```sql
-- Create test database
CREATE DATABASE restaurant_guide_test;

-- Run migrations (same as dev)
\c restaurant_guide_test
\i database_schema_v2.0.sql

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Environment Variables
```bash
# .env.test
NODE_ENV=test
DB_NAME=restaurant_guide_test
REDIS_DB=1
JWT_SECRET=test-secret-32-characters-long!!
CLOUDINARY_CLOUD_NAME=test-cloud
CLOUDINARY_API_KEY=test-key
CLOUDINARY_API_SECRET=test-secret
```

---

## Risk Assessment & Priorities

### Critical Risks (MUST FIX)
1. **Authentication Bypass** - Security vulnerability
2. **SQL Injection** - Security vulnerability
3. **Race Conditions** - Data corruption
4. **Broken Constraints** - Data integrity issues
5. **Authorization Bypass** - Security vulnerability

### High Risks (SHOULD FIX)
1. **Quota Enforcement Failures** - Business logic broken
2. **Metrics Update Errors** - Incorrect data display
3. **Search Ranking Errors** - Core feature broken
4. **Status Workflow Errors** - Business process broken

### Medium Risks (NICE TO FIX)
1. **Pagination Edge Cases** - Poor UX but not broken
2. **Validation Too Strict** - Usability issue
3. **Performance Issues** - Acceptable for MVP
4. **Error Messages Unclear** - Developer experience issue

### Low Risks (DOCUMENT)
1. **Missing Optional Features** - Not implemented yet
2. **Edge Case Behaviors** - Rare scenarios
3. **Optimization Opportunities** - Future enhancement

---

## Success Criteria

### Must Pass (Critical)
- ✅ All authentication tests pass (no security vulnerabilities)
- ✅ All authorization tests pass (proper access control)
- ✅ Database constraints enforced correctly
- ✅ No SQL injection vulnerabilities
- ✅ Rate limiting works correctly
- ✅ Token rotation prevents reuse attacks

### Should Pass (High Priority)
- ✅ All CRUD operations work correctly
- ✅ Business rules enforced (one review per establishment, daily quotas)
- ✅ Geospatial queries return accurate results
- ✅ Establishment metrics update correctly
- ✅ Idempotency works as designed
- ✅ Belarus-specific validation works

### Nice to Pass (Medium Priority)
- ✅ Edge cases handled gracefully
- ✅ Pagination works correctly in all scenarios
- ✅ Error messages are clear and actionable
- ✅ Performance acceptable for expected load

### Coverage Targets
- **Overall:** >75% line coverage
- **Critical Paths:** >90% coverage (auth, search, reviews)
- **Services:** >85% coverage
- **Controllers:** >80% coverage
- **Models:** >85% coverage

---

## Timeline Estimate

**Phase 1: Exploration** ✅ COMPLETE (2 hours)
- Project discovery
- Architecture analysis
- Create this testing plan

**Phase 2: Test Setup** (2-3 hours)
- Install Jest and dependencies
- Create test database
- Configure test environment
- Create fixtures and helpers
- Setup/teardown scripts

**Phase 3: Core Testing** (8-10 hours)
- Authentication tests (2 hours)
- Establishments tests (2.5 hours)
- Search tests (2 hours)
- Reviews tests (2 hours)
- Favorites tests (1.5 hours)
- Media tests (1.5 hours)

**Phase 4: E2E Testing** (1.5-2 hours)
- User journey tests
- Partner journey tests
- Concurrent operations
- Error recovery

**Phase 5: Bug Fixing** (4-6 hours)
- Analyze failures
- Fix bugs in source code
- Re-run tests
- Iterate until green

**Phase 6: Documentation** (1 hour)
- TESTING_REPORT.md
- BUGS_FIXED.md
- Update README.md

**Total Estimate:** 16-24 hours of focused work

---

## Key Assumptions

1. **Database Access:** I have ability to create test database and run migrations
2. **Redis Access:** Redis is available for testing
3. **No Breaking Changes:** I can fix bugs without requiring architectural changes
4. **Cloudinary Optional:** Can mock Cloudinary for most tests
5. **Local Testing:** Tests run on local development environment
6. **Node 18+:** Environment supports ES modules and modern JavaScript

---

## Known Limitations

1. **No User Model File:** Auth uses users table but no dedicated userModel.js
   - Will create helper functions as needed

2. **Search Logic Location:** Search is in establishmentService, not separate
   - Will test as part of establishments system

3. **No Admin Endpoints:** Admin moderation mentioned but not fully implemented
   - Will skip admin-specific tests

4. **OAuth Not Testable:** Google/Yandex OAuth requires external services
   - Will test OAuth code paths with mocks if possible

5. **No Email/SMS:** Email verification and SMS mentioned but not implemented
   - Will skip these tests

---

## Next Steps

After approval of this plan, I will proceed with:

1. ✅ Mark Phase 1 complete
2. 🔄 Phase 2: Install Jest and create test infrastructure
3. 🔄 Phase 3: Begin systematic testing starting with Authentication
4. 🔄 Iterative bug fixing as issues are discovered
5. 🔄 Documentation of all findings

**Ready to proceed!** 🚀

---

**Status:** Plan Complete, Awaiting Execution
**Confidence Level:** HIGH - Clear path forward
**Estimated Bugs to Find:** 15-30 bugs across all systems
**Estimated Bug Severity:** Mostly medium (business logic), some high (security)
