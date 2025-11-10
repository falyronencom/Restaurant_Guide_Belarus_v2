# Quick Start: Testing with Cursor AI

**Time to Complete:** ~30 minutes setup + 2-4 hours testing

---

## 🚀 Quick Setup (Copy-Paste Commands)

### 1. Setup Database (5 minutes)

```bash
cd /path/to/Restaurant_Guide_v2/backend

# Create database
createdb restaurant_guide_test

# Apply schema
psql -d restaurant_guide_test -f ../docs/02_architecture/database_schema_v2.0.sql

# Enable PostGIS
psql -d restaurant_guide_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Verify setup
psql -d restaurant_guide_test -c "SELECT PostGIS_version();"
psql -d restaurant_guide_test -c "\dt"
```

### 2. Setup Redis (1 minute)

```bash
# Verify Redis running
redis-cli -n 1 ping
# Expected: PONG
```

### 3. Install Dependencies (2 minutes)

```bash
npm install
```

### 4. Run Tests (5-10 minutes)

```bash
# Run all 279+ tests
npm test

# Or save output to file
npm test > test-results.log 2>&1
```

---

## 📊 Expected Results

**First Run:**
- Some tests pass ✅ (~70-80%)
- Some tests fail ❌ (~20-30%)
- This is normal! Tests will reveal bugs to fix.

**Common Issues on First Run:**
1. Database schema issues
2. PostGIS not enabled
3. Test data cleanup problems
4. Race conditions

---

## 🐛 When Tests Fail

### Quick Diagnosis

**Error:** `connect ECONNREFUSED 127.0.0.1:5432`
**Fix:** Check PostgreSQL running: `pg_isready`

**Error:** `function st_distance does not exist`
**Fix:** Enable PostGIS: `psql -d restaurant_guide_test -c "CREATE EXTENSION postgis;"`

**Error:** `column "used_at" does not exist`
**Fix:** Reapply schema (Step 1 above)

**Error:** `duplicate key value`
**Fix:** Database cleanup issue, check `clearAllData()` function

---

## 📋 What to Give Cursor AI

**Prompt for Cursor AI:**

```
I need to run backend tests and fix discovered bugs.

Context:
- Branch: claude/restaurant-guide-backend-testing-011CUpkcKTccQQfq5XrBijP3
- PostgreSQL setup: ✅ Done
- Redis running: ✅ Yes
- Dependencies: ✅ Installed

Task:
1. Run: npm test
2. Analyze failures
3. Fix bugs by priority (CRITICAL → HIGH → MEDIUM → LOW)
4. Document fixes
5. Re-run tests until 100% pass

Reference: Read CURSOR_AI_TESTING_DIRECTIVE.md for detailed instructions.

Start by running tests and analyzing the output.
```

---

## 🎯 Success = All Tests Green

```
Test Suites: X passed, X total
Tests:       279+ passed, 279+ total
Time:        ~30-60 seconds

✅ 100% SUCCESS
```

---

## 📞 Need Help?

**Read these files:**
1. `CURSOR_AI_TESTING_DIRECTIVE.md` - Comprehensive guide
2. `backend/src/tests/BUGS_FIXED.md` - Known potential issues
3. `backend/src/tests/TESTING_REPORT.md` - Infrastructure docs

**Pro Tips:**
- Fix CRITICAL bugs first
- Run tests after each fix
- Commit frequently
- Document as you go

---

**Good luck! 🚀**
