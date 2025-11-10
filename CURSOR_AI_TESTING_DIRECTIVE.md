# Cursor AI Testing Directive - Restaurant Guide Belarus Backend

**Project:** Restaurant Guide Belarus v2.0 Backend
**Task:** Execute all 279+ tests, analyze failures, fix discovered bugs
**Environment:** Local development with PostgreSQL + Redis
**Branch:** `claude/restaurant-guide-backend-testing-011CUpkcKTccQQfq5XrBijP3`
**Status:** Tests ready, database setup required

---

## 🎯 Mission

Execute comprehensive backend testing and fix all discovered bugs to achieve **100% passing tests (279+ tests)**.

---

## 📊 What We Have

**Tests Ready:**
- ✅ 214+ integration tests (5 systems: Auth, Establishments, Search, Reviews, Favorites)
- ✅ 65+ E2E journey tests (5 complete user workflows)
- ✅ Test fixtures (Belarus-specific data)
- ✅ Test helpers (auth, database, API)
- ✅ Jest configuration

**Known Issues Fixed:**
- ✅ CRITICAL Bug #1: refresh_tokens schema (fixed)
- ✅ CRITICAL Bug #2: search system missing (implemented)
- ✅ Jest configuration (fixed)
- ✅ JWT environment loading (fixed)

**Potential Issues (from code analysis):**
- See `backend/src/tests/BUGS_FIXED.md` for 18 documented issues
- May discover more during test execution

---

## 🚀 Phase 1: Database Setup (30 minutes)

### Step 1.1: Verify PostgreSQL Running

```bash
# Check PostgreSQL is running
pg_isready

# Expected output: accepting connections
```

### Step 1.2: Create Test Database

```bash
# Navigate to project
cd /path/to/Restaurant_Guide_v2/backend

# Create test database
createdb restaurant_guide_test

# Verify created
psql -l | grep restaurant_guide_test
```

### Step 1.3: Apply Database Schema

```bash
# Apply main schema
psql -d restaurant_guide_test -f ../docs/02_architecture/database_schema_v2.0.sql

# Enable PostGIS extension (CRITICAL for search tests)
psql -d restaurant_guide_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Verify PostGIS enabled
psql -d restaurant_guide_test -c "SELECT PostGIS_version();"
```

### Step 1.4: Apply Migrations

```bash
# Apply refresh_tokens migration (already included in schema, but verify)
# Check if migrations directory exists
ls migrations/

# If migrations exist, apply them:
for file in migrations/*.sql; do
  echo "Applying $file..."
  psql -d restaurant_guide_test -f "$file"
done
```

### Step 1.5: Verify Database Schema

```bash
# Connect to database
psql -d restaurant_guide_test

# Verify all tables exist
\dt

# Expected tables:
# - users
# - refresh_tokens (with used_at and replaced_by columns)
# - establishments
# - reviews
# - favorites
# - establishment_media
# - partner_documents

# Verify refresh_tokens structure
\d refresh_tokens

# Should have: id, user_id, token, expires_at, created_at, used_at, replaced_by

# Verify PostGIS
SELECT PostGIS_version();

# Exit psql
\q
```

### Step 1.6: Setup Redis

```bash
# Check Redis running
redis-cli ping
# Expected: PONG

# Verify test database (DB 1)
redis-cli -n 1 ping
# Expected: PONG

# Clear test Redis database (if needed)
redis-cli -n 1 FLUSHDB
```

### Step 1.7: Verify Environment Variables

```bash
# Check .env.test exists
cat .env.test

# Should contain:
# NODE_ENV=test
# DB_NAME=restaurant_guide_test
# DB_HOST=localhost
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=postgres
# REDIS_DB=1
# JWT_SECRET=test-jwt-secret-32-chars-long!!
```

### Step 1.8: Install Dependencies

```bash
# Install all dependencies
npm install

# Verify Jest installed
npx jest --version
```

---

## 🧪 Phase 2: Test Execution (1-2 hours)

### Step 2.1: Run All Tests (First Attempt)

```bash
# Run all 279+ tests
npm test

# This will take 5-10 minutes
# Capture full output to file for analysis
npm test > test-results-initial.log 2>&1
```

**What to Expect:**
- Some tests will pass ✅
- Some tests will fail ❌
- Error messages will guide bug fixes

### Step 2.2: Analyze Test Results

**Look for patterns in failures:**

1. **Database Connection Errors:**
   ```
   Error: connect ECONNREFUSED 127.0.0.1:5432
   ```
   **Fix:** Check PostgreSQL running, verify .env.test credentials

2. **PostGIS Errors:**
   ```
   Error: function st_distance does not exist
   ```
   **Fix:** Enable PostGIS extension (see Step 1.3)

3. **Schema Errors:**
   ```
   Error: column "used_at" does not exist
   ```
   **Fix:** Verify refresh_tokens schema (see Step 1.5)

4. **Constraint Violations:**
   ```
   Error: duplicate key value violates unique constraint
   ```
   **Fix:** Database cleanup issue, check `clearAllData()` function

5. **Timeout Errors:**
   ```
   Error: Timeout - Async callback was not invoked within the 10000 ms timeout
   ```
   **Fix:** Increase Jest timeout or optimize slow queries

### Step 2.3: Run Tests by System (If Needed)

```bash
# Run integration tests only
npm test src/tests/integration/

# Run specific system
npm test src/tests/integration/auth.test.js
npm test src/tests/integration/establishments.test.js
npm test src/tests/integration/search.test.js
npm test src/tests/integration/reviews.test.js
npm test src/tests/integration/favorites.test.js

# Run E2E tests only
npm test src/tests/e2e/

# Run specific journey
npm test src/tests/e2e/new-user-journey.test.js
```

---

## 🐛 Phase 3: Bug Fixing Strategy (2-4 hours)

### Priority Order for Bug Fixes:

**CRITICAL (Fix First):**
1. Database connection failures
2. Schema mismatches
3. PostGIS not available
4. Environment variables incorrect

**HIGH (Fix Second):**
5. Test failures due to code bugs
6. Race conditions
7. Constraint violations
8. Authorization failures

**MEDIUM (Fix Third):**
9. Timeout issues
10. Edge case failures
11. Validation errors

**LOW (Fix Last):**
12. Minor assertion failures
13. Documentation updates needed

### Step 3.1: Common Bug Patterns and Solutions

#### Bug Pattern 1: refresh_tokens Table Issues

**Symptom:**
```
Error: relation "refresh_tokens" does not exist
OR
Error: column "used_at" does not exist
```

**Diagnosis:**
```bash
psql -d restaurant_guide_test -c "\d refresh_tokens"
```

**Solution:**
If table missing or columns missing:
```sql
-- Drop and recreate table
DROP TABLE IF EXISTS refresh_tokens CASCADE;

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP,
    replaced_by UUID REFERENCES refresh_tokens(id)
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_used_at ON refresh_tokens(used_at);
```

#### Bug Pattern 2: PostGIS Not Available

**Symptom:**
```
Error: function st_distance(geometry, geometry) does not exist
```

**Solution:**
```bash
psql -d restaurant_guide_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d restaurant_guide_test -c "SELECT PostGIS_version();"
```

#### Bug Pattern 3: Search Routes Not Found

**Symptom:**
```
Error: Cannot GET /api/v1/search/establishments
Status: 404
```

**Diagnosis:**
This should be fixed already (Bug #2 from Priority 1), but verify:
```bash
ls backend/src/services/searchService.js
ls backend/src/controllers/searchController.js
ls backend/src/routes/v1/searchRoutes.js
```

**Solution:**
If files missing, they need to be created (should already exist on branch).

#### Bug Pattern 4: Test Data Cleanup Issues

**Symptom:**
```
Error: duplicate key value violates unique constraint "users_email_key"
```

**Diagnosis:**
`clearAllData()` not working properly.

**Solution:**
Check `backend/src/tests/utils/database.js`:
```javascript
// Ensure this function exists and works:
export async function clearAllData() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearAllData can only be called in test environment!');
  }

  // Disable foreign key checks temporarily
  await pool.query('SET session_replication_role = replica;');

  // Truncate all tables
  await pool.query('TRUNCATE TABLE refresh_tokens CASCADE');
  await pool.query('TRUNCATE TABLE establishment_media CASCADE');
  await pool.query('TRUNCATE TABLE favorites CASCADE');
  await pool.query('TRUNCATE TABLE reviews CASCADE');
  await pool.query('TRUNCATE TABLE establishments CASCADE');
  await pool.query('TRUNCATE TABLE users CASCADE');

  // Re-enable foreign key checks
  await pool.query('SET session_replication_role = DEFAULT;');
}
```

#### Bug Pattern 5: Review Metrics Not Updating

**Symptom:**
```
Test: "establishment metrics should update after review"
Expected: review_count > 0
Received: review_count = null or 0
```

**Diagnosis:**
Review creation doesn't trigger metrics update.

**Solution:**
Check `backend/src/services/reviewService.js` - ensure it updates establishment:
```javascript
// After creating review, update establishment metrics
const metricsQuery = `
  UPDATE establishments
  SET
    review_count = (SELECT COUNT(*) FROM reviews WHERE establishment_id = $1 AND deleted_at IS NULL),
    average_rating = (SELECT AVG(rating) FROM reviews WHERE establishment_id = $1 AND deleted_at IS NULL)
  WHERE id = $1
`;
await pool.query(metricsQuery, [establishmentId]);
```

#### Bug Pattern 6: Race Conditions

**Symptom:**
```
Test fails intermittently
Sometimes passes, sometimes fails
```

**Solution:**
1. Ensure tests run sequentially (already configured: `maxWorkers: 1`)
2. Use database transactions where needed
3. Add `await` to all async operations

#### Bug Pattern 7: Authorization Failures

**Symptom:**
```
Expected: 403 Forbidden
Received: 200 OK (or vice versa)
```

**Diagnosis:**
Authorization middleware not working correctly.

**Solution:**
Check middleware in routes:
- Partner routes should have `requireRole('partner')`
- User routes should have `authenticate()`
- Public routes should have no middleware

---

## 📝 Phase 4: Documentation and Reporting

### Step 4.1: Document All Discovered Bugs

Create `TEST_EXECUTION_REPORT.md`:

```markdown
# Test Execution Report

**Date:** [DATE]
**Branch:** claude/restaurant-guide-backend-testing-011CUpkcKTccQQfq5XrBijP3
**Environment:** Local (PostgreSQL + Redis)

## Test Results Summary

**Total Tests:** 279+
**Passing:** [X]
**Failing:** [Y]
**Success Rate:** [X/279 * 100]%

## Bugs Discovered and Fixed

### Bug 1: [Title]
**Severity:** [CRITICAL/HIGH/MEDIUM/LOW]
**File:** [path/to/file.js:line]
**Symptom:** [Error message or behavior]
**Root Cause:** [What was wrong]
**Solution:** [What was fixed]
**Tests Affected:** [Number of tests]
**Status:** ✅ Fixed

[Repeat for each bug]

## Test Failures by System

### Authentication (50+ tests)
- Passing: [X]
- Failing: [Y]
- Issues: [List]

### Establishments (65+ tests)
- Passing: [X]
- Failing: [Y]
- Issues: [List]

[Continue for all systems]

## Remaining Issues

[List any issues not yet fixed]

## Recommendations

[Next steps]
```

### Step 4.2: Update Test Statistics

Update `backend/src/tests/SESSION_SUMMARY.md` with real results:

```markdown
## Test Execution Results (Real Data)

**Date Executed:** [DATE]
**Environment:** Local PostgreSQL + Redis

| System | Tests | Passing | Failing | Success Rate |
|--------|-------|---------|---------|--------------|
| Authentication | 50+ | X | Y | Z% |
| Establishments | 65+ | X | Y | Z% |
| Search | 29 | X | Y | Z% |
| Reviews | 40+ | X | Y | Z% |
| Favorites | 30+ | X | Y | Z% |
| E2E Journeys | 65+ | X | Y | Z% |
| **TOTAL** | **279+** | **X** | **Y** | **Z%** |

## Bugs Fixed

1. [Bug 1 title and description]
2. [Bug 2 title and description]
...
```

---

## 🎯 Success Criteria

Tests are successful when:

- ✅ All 279+ tests pass
- ✅ 100% success rate
- ✅ No database errors
- ✅ No timeout errors
- ✅ All bugs documented
- ✅ All fixes committed

---

## 🚨 Troubleshooting Guide

### Problem: Tests hang indefinitely

**Solution:**
```bash
# Kill Jest process
pkill -f jest

# Clear test database
psql -d restaurant_guide_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Reapply schema
psql -d restaurant_guide_test -f ../docs/02_architecture/database_schema_v2.0.sql

# Run tests again
npm test
```

### Problem: "Jest did not exit one second after test run"

**Solution:**
Check `globalTeardown` in `jest.config.js` - ensure connections closed:
```javascript
// backend/src/tests/teardown.js
export default async function globalTeardown() {
  await pool.end(); // Close database connections
  await redisClient.quit(); // Close Redis connection
}
```

### Problem: Too many database connections

**Solution:**
```bash
# Check active connections
psql -d restaurant_guide_test -c "SELECT count(*) FROM pg_stat_activity WHERE datname='restaurant_guide_test';"

# Kill all connections (if needed)
psql -d postgres -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'restaurant_guide_test' AND pid <> pg_backend_pid();"
```

---

## 📋 Checklist

### Setup Phase
- [ ] PostgreSQL running
- [ ] Test database created
- [ ] Schema applied
- [ ] PostGIS enabled
- [ ] Migrations applied
- [ ] Redis running
- [ ] .env.test configured
- [ ] npm install completed

### Execution Phase
- [ ] All tests executed
- [ ] Results captured
- [ ] Failures analyzed
- [ ] Bugs categorized by priority

### Bug Fixing Phase
- [ ] CRITICAL bugs fixed
- [ ] HIGH priority bugs fixed
- [ ] MEDIUM priority bugs fixed
- [ ] LOW priority bugs fixed
- [ ] Tests re-run after each fix

### Documentation Phase
- [ ] TEST_EXECUTION_REPORT.md created
- [ ] SESSION_SUMMARY.md updated
- [ ] All bugs documented
- [ ] All fixes committed
- [ ] Branch pushed to remote

---

## 🎓 Tips for Efficient Bug Fixing

1. **Fix bugs in priority order** - CRITICAL first
2. **Run affected tests after each fix** - Don't wait until end
3. **Commit frequently** - After each bug fix or group of related fixes
4. **Use descriptive commit messages** - "fix: resolve race condition in review metrics (Bug #X)"
5. **Document as you go** - Don't wait until end
6. **Ask for clarification if needed** - Some bugs may be ambiguous

---

## 📞 Support Resources

**Documentation:**
- `backend/src/tests/TESTING_PLAN.md` - Original testing strategy
- `backend/src/tests/TESTING_REPORT.md` - Infrastructure documentation
- `backend/src/tests/BUGS_FIXED.md` - Known potential issues (18 documented)
- `backend/src/tests/E2E_DOCUMENTATION.md` - E2E test scenarios
- `backend/src/tests/PRIORITY_1_SUMMARY.md` - What was fixed in Priority 1

**Test Files:**
- Integration tests: `backend/src/tests/integration/*.test.js`
- E2E tests: `backend/src/tests/e2e/*.test.js`
- Test helpers: `backend/src/tests/utils/*.js`
- Test fixtures: `backend/src/tests/fixtures/*.js`

---

## ✅ Final Goal

**Achieve 100% passing tests (279+ tests) and commit all fixes to branch.**

When complete, we'll have:
- ✅ Fully tested backend
- ✅ All bugs fixed
- ✅ Production-ready code
- ✅ Comprehensive documentation
- ✅ Ready for deployment

---

**Good luck! 🚀**

**Remember:** Tests are your friends. They find bugs before users do!
