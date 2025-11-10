# End-to-End Journey Tests Documentation

**Project:** Restaurant Guide Belarus v2.0 Backend
**Test Type:** End-to-End Journey Tests
**Date Created:** November 5, 2025
**Total Journeys:** 5
**Total Tests:** 60+

---

## 📖 Overview

End-to-End (E2E) Journey Tests simulate complete user workflows through the application, testing the integration between multiple systems and verifying that real-world scenarios work correctly from start to finish.

### Difference from Integration Tests

**Integration Tests:**
- Focus on single system functionality
- Test one API endpoint at a time
- Verify system works in isolation
- Example: "Does POST /api/v1/reviews work?"

**E2E Journey Tests:**
- Simulate complete user workflows
- Test multiple systems working together
- Verify realistic user scenarios
- Example: "Can user register → search → favorite → review?"

---

## 🎯 Test Journeys

### Journey 1: New User Complete Flow
**File:** `src/tests/e2e/new-user-journey.test.js`
**Tests:** 9 tests
**Duration:** ~3-5 minutes

**Scenario:**
1. New user registers account
2. User searches for restaurants near their location
3. User adds interesting restaurant to favorites
4. User visits restaurant and leaves review
5. User checks their favorites list
6. Edge cases (duplicate favorite, duplicate review, unauthorized access)

**Systems Tested:**
- Authentication (registration)
- Search & Discovery (radius-based search)
- Favorites (add, list)
- Reviews (create)
- Integration between all systems

**Key Assertions:**
- User registration works
- Search returns correct results with distance
- Favorites are saved correctly
- Reviews update establishment metrics
- Cannot favorite twice
- Cannot review twice
- Unauthorized requests fail

---

### Journey 2: Partner Establishment Management
**File:** `src/tests/e2e/partner-journey.test.js`
**Tests:** 13 tests
**Duration:** ~4-6 minutes

**Scenario:**
1. Partner registers with partner role
2. Partner creates new establishment (draft status)
3. Partner updates establishment details
4. Partner submits for moderation (pending status)
5. Partner views their establishment list
6. Admin approves (active status) [simulated]
7. Customer leaves review
8. Partner sees updated metrics

**Systems Tested:**
- Authentication (partner registration)
- Establishments (CRUD operations)
- Status workflow (draft → pending → active)
- Reviews integration
- Ownership verification
- Authorization

**Key Assertions:**
- Partner role works correctly
- Establishment created in draft
- Status transitions work
- Only owner can edit
- Regular users cannot create establishments
- Partner sees only their establishments
- Reviews update establishment metrics

---

### Journey 3: Search & Discovery Complete Flow
**File:** `src/tests/e2e/search-discovery-journey.test.js`
**Tests:** 16 tests
**Duration:** ~5-7 minutes

**Scenario:**
1. User searches near location (wide radius)
2. User filters by category (Кофейня)
3. User filters by cuisine (Народная)
4. User filters by price range ($)
5. User combines multiple filters
6. User switches to map view (bounds search)
7. User narrows search radius
8. User uses pagination

**Systems Tested:**
- Search & Discovery (all features)
- PostGIS geospatial queries
- Dynamic filtering
- Distance calculations
- Pagination
- Map view (bounds-based search)

**Key Assertions:**
- Radius search finds correct establishments
- Results include accurate distance
- Results ordered by distance (closest first)
- Category filter works
- Cuisine filter works
- Price filter works
- Combined filters work
- Bounds search works
- Pagination works
- Edge cases (invalid coordinates, zero radius, etc.)
- PostGIS distance calculations accurate

---

### Journey 4: Authentication Complete Flow
**File:** `src/tests/e2e/auth-journey.test.js`
**Tests:** 16 tests
**Duration:** ~4-6 minutes

**Scenario:**
1. User registers new account
2. User accesses protected endpoint
3. User logs out
4. User logs back in
5. User refreshes access token
6. User logs in with phone (instead of email)
7. Security verification (weak password, duplicate email, wrong password, etc.)

**Systems Tested:**
- Authentication (complete lifecycle)
- JWT token management
- Session management
- Security measures
- Email/phone normalization

**Key Assertions:**
- Registration successful
- Protected endpoints require authentication
- Logout invalidates refresh token
- Login provides new tokens
- Token refresh works
- Phone login works
- Weak passwords rejected
- Duplicate emails rejected
- Non-Belarus phones rejected
- Wrong passwords rejected
- Invalid tokens rejected
- Email normalized to lowercase
- Phone normalized (spaces removed)
- Case-insensitive email login

---

### Journey 5: Reviews & Favorites Integration
**File:** `src/tests/e2e/reviews-favorites-integration.test.js`
**Tests:** 11 tests
**Duration:** ~5-7 minutes

**Scenario:**
1. User discovers establishments via search
2. User adds 3 establishments to favorites
3. User reviews all 3 favorites (different ratings)
4. Metrics update correctly
5. User updates one review
6. User deletes one review
7. User removes from favorites
8. User checks review quota
9. Verification: favorites and reviews independent
10. Verification: user isolation (cannot edit others' reviews)

**Systems Tested:**
- Search → Favorites → Reviews integration
- Review metrics calculation
- User permissions
- Data consistency
- User isolation

**Key Assertions:**
- Can search, favorite, and review workflow
- Establishment metrics update (average_rating, review_count)
- Can update own reviews
- Can delete own reviews
- Removing favorite doesn't delete review
- Can review without favoriting
- Multiple users can review/favorite same establishment
- Users only see own favorites
- Cannot edit others' reviews
- Cannot delete others' reviews

---

## 🚀 Running E2E Tests

### Prerequisites

1. **PostgreSQL database with PostGIS**
   ```bash
   createdb restaurant_guide_test
   psql -d restaurant_guide_test -f docs/02_architecture/database_schema_v2.0.sql
   psql -d restaurant_guide_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   ```

2. **Redis server**
   ```bash
   redis-server
   # Verify: redis-cli -n 1 ping (should return PONG)
   ```

3. **Environment variables (.env.test)**
   - Already configured
   - See `backend/.env.test`

### Run All E2E Tests

```bash
cd backend

# Run all E2E tests
npm test src/tests/e2e/

# Run specific journey
npm test src/tests/e2e/new-user-journey.test.js

# Run with verbose output
npm test -- --verbose src/tests/e2e/

# Run with coverage
npm run test:coverage -- src/tests/e2e/
```

### Expected Output

```
PASS  src/tests/e2e/new-user-journey.test.js
  E2E Journey: New User Complete Flow
    Complete User Journey
      ✓ STEP 1: New user registers successfully (150ms)
      ✓ STEP 2: User searches for restaurants near Minsk center (200ms)
      ✓ STEP 3: User adds interesting restaurant to favorites (100ms)
      ✓ STEP 4: User visits restaurant and leaves a positive review (150ms)
      ✓ STEP 5: User checks their favorites list (80ms)
      ✓ INTEGRATION: Verify complete user state after journey (120ms)
    Edge Cases in User Journey
      ✓ User cannot add same establishment to favorites twice (90ms)
      ✓ User cannot leave second review for same establishment (100ms)
      ✓ User cannot review without being authenticated (50ms)

Test Suites: 5 passed, 5 total
Tests:       60+ passed, 60+ total
Time:        ~25-30 seconds
```

---

## 📊 Test Statistics

| Journey | Tests | Lines | Systems | Duration |
|---------|-------|-------|---------|----------|
| New User Flow | 9 | 280 | 4 | 3-5 min |
| Partner Management | 13 | 370 | 3 | 4-6 min |
| Search & Discovery | 16 | 420 | 1 | 5-7 min |
| Authentication | 16 | 350 | 1 | 4-6 min |
| Reviews & Favorites | 11 | 430 | 3 | 5-7 min |
| **TOTAL** | **65+** | **1,850** | **5** | **21-31 min** |

---

## 🎯 What These Tests Verify

### Functional Requirements
- ✅ Users can register and authenticate
- ✅ Users can search for establishments by location
- ✅ Users can filter search results
- ✅ Users can add establishments to favorites
- ✅ Users can leave reviews with ratings
- ✅ Partners can manage establishments
- ✅ Establishment status workflow works
- ✅ Metrics update correctly

### Integration Points
- ✅ Auth → Search (authenticated search if needed)
- ✅ Search → Favorites (discover → bookmark)
- ✅ Favorites → Reviews (bookmark → review)
- ✅ Reviews → Establishments (metrics update)
- ✅ Partner → Establishments → Reviews (ownership → feedback)

### Security & Authorization
- ✅ Protected endpoints require authentication
- ✅ Users can only edit their own data
- ✅ Partners can only manage their own establishments
- ✅ Regular users cannot access partner endpoints
- ✅ Invalid tokens rejected
- ✅ Weak passwords rejected
- ✅ Non-Belarus phones rejected

### Data Consistency
- ✅ No duplicate favorites
- ✅ No duplicate reviews (one per user per establishment)
- ✅ User isolation (favorites, reviews)
- ✅ Metrics accurately reflect reviews
- ✅ Deleting favorite doesn't delete review
- ✅ Status transitions follow workflow

### User Experience
- ✅ Registration is straightforward
- ✅ Search returns relevant results
- ✅ Filters work intuitively
- ✅ Favorites are easily managed
- ✅ Reviews can be updated/deleted
- ✅ Error messages are clear

---

## 🐛 What E2E Tests Catch

E2E tests are excellent at catching:

1. **Integration Bugs**
   - "Search works, favorites work, but search → favorites breaks"
   - Systems work individually but not together

2. **Workflow Issues**
   - "User can create review but cannot update it"
   - Complete journeys reveal missing steps

3. **State Management Problems**
   - "Establishment metrics don't update after review"
   - Data inconsistency between systems

4. **Authorization Holes**
   - "User can edit other user's review"
   - Security gaps in cross-system operations

5. **Real-World Scenarios**
   - "What if user favorites, then reviews, then removes favorite?"
   - Edge cases that aren't obvious in unit tests

---

## 🔧 Maintenance

### Adding New Journeys

1. **Create new test file**
   ```javascript
   // src/tests/e2e/my-new-journey.test.js
   import { app, cleanDatabase, ... } from './helpers.js';

   describe('E2E Journey: My New Feature', () => {
     beforeAll(async () => {
       await cleanDatabase();
       // Setup
     });

     test('STEP 1: User does something', async () => {
       // Test step
     });
   });
   ```

2. **Follow naming convention**
   - `STEP N:` for sequential journey steps
   - Clear descriptions of what user does
   - Focus on user actions, not technical details

3. **Use helpers**
   - `src/tests/e2e/helpers.js` has common operations
   - Add new helpers if needed
   - Keep tests readable

4. **Update this documentation**
   - Add journey to list above
   - Document scenario and assertions
   - Update statistics table

### Updating Existing Journeys

When features change:
1. **Update affected journey tests**
2. **Verify all steps still make sense**
3. **Add new assertions if needed**
4. **Update documentation**

### Test Debugging

If E2E test fails:
1. **Check which STEP failed** - pinpoints the problem
2. **Run that journey in isolation** - eliminates interference
3. **Check database state** - use `psql` to inspect
4. **Review logs** - test output shows HTTP responses
5. **Use debugger** - set breakpoints in test

---

## 📝 Best Practices

### Writing E2E Tests

**DO:**
- ✅ Test realistic user workflows
- ✅ Use clear step descriptions (STEP 1, STEP 2...)
- ✅ Clean database before each journey
- ✅ Verify integration between systems
- ✅ Test edge cases (duplicate, unauthorized, etc.)
- ✅ Use helpers for common operations
- ✅ Make assertions comprehensive

**DON'T:**
- ❌ Test every possible permutation (that's for integration tests)
- ❌ Skip cleanup (causes test interference)
- ❌ Test technical implementation details
- ❌ Make tests depend on each other
- ❌ Ignore failures ("it works on my machine")

### Organizing Journeys

- One journey per user type or major workflow
- Keep journeys focused (5-15 tests max)
- Group related edge cases together
- Use descriptive describe() blocks

---

## 🎓 Learning from E2E Tests

These E2E tests serve as:

1. **Living Documentation**
   - Shows how features actually work together
   - Demonstrates complete workflows
   - Examples of correct API usage

2. **Regression Protection**
   - Catches breaking changes in integration
   - Verifies complete workflows still work
   - Protects against feature interactions

3. **Quality Assurance**
   - Proves system works end-to-end
   - Builds confidence for production deployment
   - Validates user experience

---

## 📚 References

- Integration Tests: `src/tests/integration/`
- Test Helpers: `src/tests/e2e/helpers.js`
- Test Fixtures: `src/tests/fixtures/`
- Testing Plan: `src/tests/TESTING_PLAN.md`
- Testing Report: `src/tests/TESTING_REPORT.md`

---

## ✅ Success Criteria

E2E tests are successful when:
- ✅ All 65+ tests pass
- ✅ Complete user workflows verified
- ✅ Integration bugs caught
- ✅ Real-world scenarios work
- ✅ Security measures effective
- ✅ Data consistency maintained

---

**Document Version:** 1.0
**Last Updated:** November 5, 2025
**Maintained By:** Testing Team
