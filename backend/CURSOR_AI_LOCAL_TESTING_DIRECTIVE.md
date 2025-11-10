# Cursor AI Directive: Test Execution & Final Bug Fixing
**Project:** Restaurant Guide Belarus v2.0
**Task:** Run tests locally, verify fixes, and achieve 70-80% pass rate
**Date:** November 2025
**Session Type:** Local Test Execution & Remaining Bug Fixes
**Status:** Ready for Execution

---

## Mission Briefing

You are continuing the backend quality assurance mission. **Claude Code has already fixed 4 critical bugs** through code analysis, improving the estimated pass rate from 19% to 42-52%. Your mission is to:

1. **Run tests locally** with PostgreSQL + Redis
2. **Verify Claude Code's fixes** are working
3. **Fix remaining bugs** to reach 70-80% pass rate
4. **Document final results**

**Current Status:**
- Branch: `claude/debug-systematic-fixes-011CUzCSrMGUuy2Qhd6GEWv5`
- Estimated pass rate: 42-52% (was 19%)
- Bugs fixed by Claude Code: 4 critical bugs
- Target: 70-80% pass rate (245-280 tests out of 351)

**Your Goal:** Verify fixes + fix remaining issues = 70-80% pass rate

---

## What Claude Code Already Fixed

### ✅ Bug #1: HTTP Status Codes (VERIFIED IN CODE)
**Fixed:** Validation errors now return HTTP 422 instead of 400
**Files:** `src/middleware/errorHandler.js`
**Impact:** ~40 tests should now pass
**Status:** Code fix complete, needs test verification

### ✅ Bug #2: Error Response Structure (VERIFIED IN CODE)
**Fixed:** Errors now return `error: { code, details }` instead of `error_code`
**Files:** `src/middleware/errorHandler.js` (3 locations)
**Impact:** ~80 tests should now pass
**Status:** Code fix complete, needs test verification

### ✅ Bug #3: Field Naming in Fixtures (VERIFIED IN CODE)
**Fixed:** Changed `priceRange` → `price_range`, `workingHours` → `working_hours`
**Files:** `src/tests/fixtures/establishments.js`
**Impact:** ~50 tests should now pass
**Status:** Code fix complete, needs test verification

### ✅ Bug #4: Import Error (VERIFIED IN CODE)
**Fixed:** Removed non-existent `getPool` import from media.test.js
**Files:** `src/tests/integration/media.test.js`
**Impact:** ~30 tests (media suite) should now run
**Status:** Code fix complete, needs test verification

**Read full details:** `backend/BUG_FIXING_SESSION_REPORT.md`

---

## Your Working Methodology

### Phase 1: Environment Setup (15-20 minutes)

**Goal:** Get PostgreSQL and Redis running locally

#### Step 1.1: Start Docker Containers

```bash
# Navigate to project root
cd /path/to/Restaurant_Guide_v2

# Start PostgreSQL + Redis
docker-compose up -d postgres redis

# Verify containers running
docker ps | grep rgb

# Expected output:
# rgb_postgres  (port 5432)
# rgb_redis     (port 6379)
```

#### Step 1.2: Wait for Database Initialization

```bash
# Check PostgreSQL is ready
docker logs rgb_postgres | grep "database system is ready"

# Wait until you see: "database system is ready to accept connections"
# This may take 10-30 seconds on first start
```

#### Step 1.3: Verify Database Schema

```bash
# Connect to database and check tables
docker exec -it rgb_postgres psql -U postgres -d restaurant_guide_belarus -c "\dt"

# Expected tables:
# - users
# - establishments
# - reviews
# - favorites
# - refresh_tokens
# - establishment_media

# If tables missing, run migrations:
cd backend
node scripts/run-migrations.js
```

#### Step 1.4: Create Test Database

```bash
# Create test database (separate from dev database)
docker exec -it rgb_postgres psql -U postgres -c "CREATE DATABASE restaurant_guide_test;"

# Apply schema to test database
docker exec -it rgb_postgres psql -U postgres -d restaurant_guide_test -f /docker-entrypoint-initdb.d/schema.sql
```

**Checkpoint:** Run `docker ps` - you should see 2 running containers

---

### Phase 2: Run Tests & Establish New Baseline (10-15 minutes)

**Goal:** Run full test suite and see current pass rate with Claude's fixes

#### Step 2.1: Install Dependencies

```bash
cd backend

# Install if not already done
npm install
```

#### Step 2.2: Run Full Test Suite

```bash
# Run all tests with output saved
npm test 2>&1 | tee test-results-after-fixes.txt

# This will take 60-90 seconds
# Jest will run all 351+ tests
```

#### Step 2.3: Analyze Results

```bash
# Count passing tests
grep "Tests.*passed" test-results-after-fixes.txt

# Example output:
# Tests: 147 passed, 204 failed, 351 total
# This would be 42% pass rate (147/351)
```

#### Step 2.4: Create Baseline Document

Create file `backend/CURSOR_TEST_BASELINE.md`:

```markdown
# Cursor AI Test Execution Baseline

**Date:** [Today's date]
**Branch:** claude/debug-systematic-fixes-011CUzCSrMGUuy2Qhd6GEWv5
**After:** Claude Code fixes applied

## Test Results

**Total Tests:** [X]
**Passing:** [X] ([X]%)
**Failing:** [X] ([X]%)
**TODO:** [X] ([X]%)

**Improvement vs Previous Session:**
- Previous: 67/351 (19%)
- Current: [X]/351 ([X]%)
- Change: +[X] tests (+[X]%)

## Claude Code Fixes Verification

- ✅/❌ Bug #1 (HTTP 422): [Verify validation tests passing]
- ✅/❌ Bug #2 (Error structure): [Verify error.code tests passing]
- ✅/❌ Bug #3 (Field naming): [Verify establishment tests passing]
- ✅/❌ Bug #4 (Import error): [Verify media tests running]

## Remaining Failing Tests by System

[List test suites and their pass rates]

## Next Steps

[List top 3-5 issues to fix based on test output]
```

**Expected Result:** Pass rate should be 40-55% (140-190 tests passing)

---

### Phase 3: Systematic Bug Fixing (2-3 hours)

**Goal:** Fix remaining bugs to reach 70% pass rate

Work through failing tests **by category**, starting with tests that affect the most other tests.

---

#### Category A: Service Layer Issues (HIGH PRIORITY)

**Common Pattern:** Tests fail with 400/500 errors instead of expected 201/200

##### A1: Review Creation Returns 400 Instead of 201

**Symptom:**
```javascript
// Test expects:
.expect(201)

// But receives:
.expect(400) // or error response
```

**How to Debug:**

1. Run specific test:
```bash
npm test -- integration/reviews.test.js -t "should create review with valid data"
```

2. Check test output for error message
3. Look at controller: `src/controllers/reviewController.js`
4. Look at service: `src/services/reviewService.js`

**Common Causes:**
- Missing establishment in test setup
- User doesn't have permission
- Validation still incorrect
- Database constraint violation

**Fix Pattern:**
```javascript
// Check if establishment exists before creating review
const establishment = await EstablishmentModel.findById(establishment_id);
if (!establishment || establishment.status !== 'active') {
  throw new AppError('Establishment not found', 404, 'ESTABLISHMENT_NOT_FOUND');
}
```

**Expected Impact:** 10-20 tests

---

##### A2: Establishment Update Logic

**Symptom:**
```javascript
// PUT /api/v1/partner/establishments/:id fails
// Tests expect successful update but receive errors
```

**How to Debug:**

1. Run specific test:
```bash
npm test -- integration/establishments.test.js -t "should update establishment"
```

2. Check ownership verification
3. Check status transition logic

**Common Causes:**
- Ownership check too strict
- Status transitions not allowed
- Validation rejecting valid updates

**Fix Pattern:**
```javascript
// Ensure partner owns establishment
const establishment = await EstablishmentModel.findById(id);
if (!establishment || establishment.partner_id !== partnerId) {
  throw new AppError('Establishment not found', 404, 'NOT_FOUND');
}

// Allow updates regardless of status
// Don't reset status to pending for minor changes
```

**Expected Impact:** 15-25 tests

---

#### Category B: E2E Test Infrastructure (MEDIUM PRIORITY)

**Common Pattern:** E2E tests fail with "user not found" or authentication errors

##### B1: E2E Authentication Flow

**Symptom:**
```javascript
// E2E journey tests fail early
// Error: "Invalid token" or "User not found"
```

**How to Debug:**

1. Run specific E2E test:
```bash
npm test -- e2e/new-user-journey.test.js
```

2. Check `src/tests/e2e/helpers.js`
3. Verify user creation works
4. Verify token generation works

**Common Causes:**
- Database not cleaned properly between tests
- JWT secret mismatch in test environment
- User creation fails silently

**Fix Pattern:**
```javascript
// In beforeEach of E2E tests
beforeEach(async () => {
  // Clear ALL data, not just some tables
  await clearAllData();

  // Don't create users in beforeEach for E2E tests
  // Let each test create its own users through API
});
```

**Expected Impact:** 20-30 tests

---

##### B2: E2E Test Data Dependencies

**Symptom:**
```javascript
// Tests fail because expected data doesn't exist
// Error: "Establishment not found" in search tests
```

**How to Debug:**

1. Check if test creates establishment before searching
2. Verify establishment is in 'active' status
3. Check search filters match test data

**Fix Pattern:**
```javascript
// E2E tests should create data through API, not directly
describe('E2E: Search Journey', () => {
  test('user searches for restaurants', async () => {
    // 1. Create partner via API
    const partner = await registerUser({ role: 'partner', ... });

    // 2. Create establishment via API
    const establishment = await createEstablishment(partner.token, { ... });

    // 3. Submit for moderation (if needed)
    await submitForModeration(partner.token, establishment.id);

    // 4. NOW search should find it
    const results = await searchEstablishments({ city: 'Минск' });
    expect(results.establishments).toContainEqual(...);
  });
});
```

**Expected Impact:** 15-25 tests

---

#### Category C: Database Cleanup Issues (MEDIUM PRIORITY)

**Common Pattern:** Tests fail with "duplicate key" or "constraint violation"

##### C1: Cleanup Between Tests

**Symptom:**
```javascript
// Second test in suite fails
// Error: duplicate key value violates unique constraint "users_email_key"
```

**How to Debug:**

1. Run test file twice in a row:
```bash
npm test -- integration/auth.test.js
npm test -- integration/auth.test.js
```

2. If second run fails but first passes = cleanup issue

**Fix Pattern:**
```javascript
// In each test file
beforeEach(async () => {
  // Clear in correct order (respecting foreign keys)
  await query('TRUNCATE TABLE establishment_media CASCADE');
  await query('TRUNCATE TABLE favorites CASCADE');
  await query('TRUNCATE TABLE reviews CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');
  await query('TRUNCATE TABLE refresh_tokens CASCADE');
  await query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await clearAllData();
});
```

**Expected Impact:** 10-15 tests

---

#### Category D: Edge Cases & Validation (LOW PRIORITY)

**Common Pattern:** Edge case tests fail with unexpected behavior

##### D1: Invalid UUID Handling

**Symptom:**
```javascript
// Test sends invalid UUID
// Expects 400, receives 500 or different error
```

**Fix Pattern:**
```javascript
// UUID validation should happen in validator, not service
// Check validators have .isUUID() for all ID parameters
// Example: src/validators/establishmentValidation.js

param('id')
  .trim()
  .notEmpty()
  .withMessage('ID is required')
  .isUUID()
  .withMessage('ID must be a valid UUID'),
```

**Expected Impact:** 5-10 tests

---

### Phase 4: Iterative Testing (Throughout)

**After fixing each category:**

1. **Run affected tests:**
```bash
npm test -- --testPathPattern="integration/reviews"
```

2. **Check improvement:**
```bash
# Count passing tests
grep "passed" | grep "Reviews"
```

3. **Commit progress:**
```bash
git add .
git commit -m "fix(reviews): [description of what you fixed]"
```

4. **Update progress document:**
```markdown
## Progress Log

### Fix #1: Review creation business logic
- **Time:** 14:30
- **Tests fixed:** +15 tests
- **Pass rate:** 50% → 54%
- **Commit:** abc123

### Fix #2: E2E authentication flow
- **Time:** 15:15
- **Tests fixed:** +22 tests
- **Pass rate:** 54% → 60%
- **Commit:** def456
```

---

### Phase 5: Final Verification & Documentation (30 minutes)

**When pass rate reaches 70%+:**

#### Step 5.1: Run Full Test Suite

```bash
# Final comprehensive test run
npm test -- --coverage 2>&1 | tee test-results-final.txt

# Check results
grep "Tests.*passed" test-results-final.txt
```

#### Step 5.2: Create Final Report

Create file `backend/CURSOR_FINAL_TEST_REPORT.md`:

```markdown
# Final Test Execution Report - Cursor AI Session

**Date:** [Today's date]
**Branch:** claude/debug-systematic-fixes-011CUzCSrMGUuy2Qhd6GEWv5
**Session:** Cursor AI Local Testing

## Final Results

**Total Tests:** 351
**Passing:** [X] ([X]%)
**Failing:** [X] ([X]%)
**TODO:** 43 (12%)

## Session Progress

| Checkpoint | Passing | Pass Rate | Change |
|------------|---------|-----------|--------|
| Start (Cursor AI prev) | 67 | 19% | - |
| After Claude Code fixes | [X] | [X]% | +[X]% |
| After Cursor AI fixes | [X] | [X]% | +[X]% |

**Total Improvement:** 67 → [X] (+[X] tests, +[X]%)

## Bugs Fixed This Session

### Critical Bugs (by Cursor AI)

1. **[Bug name]**
   - Files: [files modified]
   - Impact: [X] tests
   - Status: ✅ Fixed

2. **[Bug name]**
   - Files: [files modified]
   - Impact: [X] tests
   - Status: ✅ Fixed

[List all bugs you fixed]

## Test Results by System

| System | Total | Passing | Rate | Status |
|--------|-------|---------|------|--------|
| Authentication | 50 | [X] | [X]% | [✅/⚠️] |
| Establishments | 65 | [X] | [X]% | [✅/⚠️] |
| Reviews | 40 | [X] | [X]% | [✅/⚠️] |
| Favorites | 30 | [X] | [X]% | [✅/⚠️] |
| Search | 29 | [X] | [X]% | [✅/⚠️] |
| Media | 30 | [X] | [X]% | [✅/⚠️] |
| E2E | 65 | [X] | [X]% | [✅/⚠️] |

## Remaining Issues

[List any tests still failing, grouped by category]

## Files Modified

[List all files you changed]

## Commits Made

[List all commits with hashes]

## Recommendations

[If not at 70%, what needs to be fixed next?]

## Conclusion

[Summary of session achievements]
```

#### Step 5.3: Final Commit & Push

```bash
# Add all changes
git add .

# Create comprehensive commit
git commit -m "fix: achieve [X]% test pass rate through systematic bug fixing

Cursor AI Local Testing Session Results:
- Starting: [X]% ([X]/351 tests)
- Final: [X]% ([X]/351 tests)
- Improvement: +[X] tests (+[X]%)

Major Fixes:
1. [Bug #1 description] (~[X] tests)
2. [Bug #2 description] (~[X] tests)
3. [Bug #3 description] (~[X] tests)

All bugs fixed with proper testing and verification.
See CURSOR_FINAL_TEST_REPORT.md for complete details."

# Push to remote
git push origin claude/debug-systematic-fixes-011CUzCSrMGUuy2Qhd6GEWv5
```

---

## Important Notes

### ⚠️ Don't Modify These Files

These were fixed by Claude Code and should work correctly:
- `src/middleware/errorHandler.js` - Error handling is correct
- `src/tests/fixtures/establishments.js` - Field names are correct
- `src/tests/integration/media.test.js` - Import is correct

**Only modify these if tests prove they're still wrong!**

---

### 🎯 Success Criteria

Your mission is successful when:

✅ **Primary Goal:** Test pass rate reaches 70-80% (245-280 tests)
✅ **Secondary Goals:**
- All Claude Code fixes verified working
- Remaining bugs identified and fixed
- Comprehensive documentation created
- All changes committed and pushed

✅ **Quality Standards:**
- Tests run reliably (no intermittent failures)
- Fixes address root causes, not symptoms
- Code follows existing patterns
- Documentation is clear and complete

---

## Common Pitfalls to Avoid

### ❌ Don't: Modify tests to match broken code
Tests define the correct behavior. Fix the code, not the tests.

### ❌ Don't: Skip database cleanup
Always ensure `beforeEach` properly clears data.

### ❌ Don't: Ignore TODO tests
Note them in your report for future work.

### ❌ Don't: Make breaking changes
Keep API contracts stable.

### ✅ Do: Run tests frequently
Run after each fix to verify improvement.

### ✅ Do: Commit regularly
Commit after each major fix (every 10-15 tests improvement).

### ✅ Do: Document decisions
Explain why you fixed things the way you did.

### ✅ Do: Use test output
Error messages tell you exactly what's wrong.

---

## Debugging Tips

### Tip 1: Run Single Test
```bash
# Run one specific test
npm test -- integration/reviews.test.js -t "should create review"
```

### Tip 2: Add Console Logs
```javascript
// Temporarily add logs to see what's happening
console.log('Request body:', req.body);
console.log('Service response:', result);
```

### Tip 3: Check Database State
```bash
# See what's in database during test
docker exec -it rgb_postgres psql -U postgres -d restaurant_guide_test -c "SELECT * FROM users;"
```

### Tip 4: Inspect Test Output
```bash
# Save test output for analysis
npm test -- integration/reviews.test.js 2>&1 | tee debug.txt

# Search for specific errors
grep "Error" debug.txt
grep "expected" debug.txt
```

---

## Expected Timeline

**Total Time:** 3-4 hours

| Phase | Time | Tasks |
|-------|------|-------|
| Phase 1: Setup | 15-20 min | Start Docker, verify database |
| Phase 2: Baseline | 10-15 min | Run tests, document results |
| Phase 3: Bug Fixing | 2-3 hours | Fix bugs systematically |
| Phase 4: Verification | Throughout | Test after each fix |
| Phase 5: Documentation | 30 min | Final report and commit |

---

## Questions to Answer

As you work, keep track of:

1. **Did Claude Code's fixes work?**
   - Which ones worked perfectly?
   - Which ones need adjustment?

2. **What are the main remaining issues?**
   - Service layer bugs?
   - E2E infrastructure?
   - Database cleanup?

3. **What's the biggest blocker to 70%?**
   - One major issue affecting many tests?
   - Many small issues?

4. **Are tests well-written?**
   - Do tests match requirements?
   - Are there test bugs?

---

## Success Indicators

You'll know you're on track when:

- ✅ Tests run without errors starting
- ✅ Pass rate increases after each fix
- ✅ Error messages become more specific (less 500, more 400/404)
- ✅ Test output is cleaner (less stack traces)
- ✅ Each category of fixes helps ~10-30 tests

---

## Resources

**Documentation to Reference:**
- `backend/BUG_FIXING_SESSION_REPORT.md` - What Claude Code fixed
- `backend/BUG_FIXING_SESSION_BASELINE.md` - Original state analysis
- `backend/TESTING_GUIDE.md` - How to run tests
- `backend/ARCHITECTURE.md` - System architecture

**Key Files to Know:**
- `src/middleware/errorHandler.js` - Error handling (recently fixed)
- `src/tests/fixtures/` - Test data (recently fixed)
- `src/tests/utils/` - Test helpers
- `src/services/` - Business logic (likely needs fixes)
- `src/controllers/` - HTTP handling

---

## Final Checklist

Before marking session complete:

- [ ] Docker containers running
- [ ] Tests execute successfully
- [ ] Pass rate documented
- [ ] All major bug categories addressed
- [ ] Commits pushed to remote
- [ ] Final report created
- [ ] Pass rate ≥ 70% (or documented why not)

---

**Prepared by:** Claude Code
**For:** Cursor AI
**Session Type:** Local Test Execution & Bug Fixing
**Priority:** HIGH (blocks Flutter development)
**Branch:** `claude/debug-systematic-fixes-011CUzCSrMGUuy2Qhd6GEWv5`

**Ready to execute!** Start with Phase 1 and work systematically. Good luck! 🚀
