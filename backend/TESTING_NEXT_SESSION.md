# Testing Establishments System - Quick Start Guide

**For:** Next Cursor IDE Session  
**Task:** Test the integrated Establishments Management System  
**Prerequisites:** Read HANDOFF_ESTABLISHMENTS.md for full context

---

## 🎯 Your Mission

Test the fully integrated Establishments Management System (Phase One + Two).  
Code is committed, pushed, and ready for testing.

**Commits:**
- `9f52767` - Phase One (Establishment CRUD)
- `c4efddc` - Phase Two (Media Management)

---

## ⚡ Pre-Test Setup (5 minutes)

### 1. Create .env file
```bash
cd backend
nano .env  # or use your editor
```

Add these lines:
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Get credentials from: https://cloudinary.com/console

### 2. Verify dependencies
```bash
npm install  # Should be already installed
```

Verify these exist in package.json:
- cloudinary
- multer
- uuid

### 3. Check directory structure
```bash
ls -la src/config/cloudinary.js           # Should exist
ls -la src/models/mediaModel.js            # Should exist
ls -la tmp/uploads/                        # Should exist (or create it)
mkdir -p tmp/uploads                       # Create if needed
```

### 4. Verify database tables
```sql
\c restaurant_guide  -- or your DB name
\d establishments
\d establishment_media
```

Both tables must exist. If not, run migrations first.

---

## 🚀 Start Server

```bash
npm run dev
```

**Expected output:**
```
Server running on port 3000
Database connected
Redis connected
```

**If server doesn't start:**
- Check HANDOFF_ESTABLISHMENTS.md → "Common Issues"
- Verify all environment variables
- Check database connection

---

## 🧪 Testing Sequence

### Quick Smoke Test (5 minutes)

**1. Health Check**
```bash
curl http://localhost:3000/api/v1/health
```
Expected: 200 OK

**2. Get Auth Token**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"partner@test.com","password":"test123"}'
```
Save the access_token from response.

**3. Test Establishment Endpoint**
```bash
TOKEN="your_token_here"
curl -X GET http://localhost:3000/api/v1/partner/establishments \
  -H "Authorization: Bearer $TOKEN"
```
Expected: 200 OK with array (may be empty)

**If these 3 pass → System is working! ✅**

---

## 📋 Available Test Artifacts

User mentioned having test artifacts from Leaf session:
- Smoke tests
- Automated tests

**Ask user to provide these artifacts, then:**

1. **Review test structure** - understand what they test
2. **Integrate test files** - place in appropriate directories
3. **Configure test environment** - update any paths/configs
4. **Run tests** - execute and analyze results
5. **Fix issues** - address any failures found
6. **Document results** - create test report

---

## 🔍 What to Test

### Phase One: Establishments

**Create (POST /establishments)**
- Valid data → 201 Created
- Invalid city → 422 Error
- Invalid coordinates → 422 Error
- Missing required fields → 400 Error
- Duplicate name → 409 Error

**List (GET /establishments)**
- No filter → returns all
- Filter by status → returns filtered
- Pagination → works correctly
- Empty result → returns []

**Get Details (GET /establishments/:id)**
- Valid ID, owned → 200 OK with data
- Valid ID, not owned → 404 Not Found
- Invalid UUID → 422 Error

**Update (PUT /establishments/:id)**
- Valid updates → 200 OK
- Major changes → status reset to 'pending'
- Not owner → 404 Error
- Invalid data → 422 Error

**Submit (POST /establishments/:id/submit)**
- Draft status → 200 OK, status='pending'
- Not draft → 400 Error
- Missing required fields → 400 Error

### Phase Two: Media

**Upload (POST /establishments/:id/media)**
- Valid image + metadata → 201 Created
- No file → 400 Error
- Invalid type → 422 Error
- File too large → 413 Error
- Tier limit reached → 403 Error
- is_primary=true → sets as primary

**List (GET /establishments/:id/media)**
- Returns all media
- Filter by type → works
- Correct order (position, created_at)

**Update (PUT /establishments/:id/media/:mediaId)**
- Update caption → 200 OK
- Update position → 200 OK
- Set is_primary=true → only this is primary

**Delete (DELETE /establishments/:id/media/:mediaId)**
- Deletes from DB → verified
- Deletes from Cloudinary → check logs
- Was primary → another set as primary

---

## 🐛 Common Test Failures

### Authentication Fails
- Check JWT token is valid and not expired
- Verify partner role exists on user
- Check Authorization header format: "Bearer {token}"

### File Upload Fails
- Verify Content-Type is multipart/form-data
- Field name must be 'file'
- File must be < 10MB
- File type must be image (JPEG/PNG/WebP/HEIC)

### Cloudinary Upload Fails
- Check .env credentials are correct
- Test login to Cloudinary dashboard
- Verify internet connection
- Check Cloudinary free tier limits

### Tier Limit Errors
- Check subscription_tier in establishments table
- Count existing media in establishment_media table
- Limits: free=10+10, basic=15+15, standard=20+20, premium=30+30

### Primary Photo Issues
- Only one primary allowed per establishment
- When set, others automatically set to false
- When deleted, another auto-promoted to primary

---

## 📊 Expected Results

### Smoke Tests
- **Duration:** ~15 minutes
- **Coverage:** Critical paths only
- **Goal:** Verify nothing is broken
- **Pass Rate:** 100% (or close)

### Automated Tests
- **Duration:** ~30 minutes
- **Coverage:** All endpoints + edge cases
- **Goal:** Comprehensive validation
- **Pass Rate:** >90% acceptable, >95% ideal

### Issues Found
- **Critical bugs:** Must fix before deployment
- **Minor bugs:** Document for later
- **Edge cases:** Document as known limitations

---

## 📝 After Testing

### If All Tests Pass ✅
1. Create TESTING_RESULTS.md with summary
2. Commit test files: `git add tests/` then `git commit -m "test: Add test suite for Establishments"`
3. Document any setup quirks
4. Ready for staging deployment!

### If Tests Fail ❌
1. Analyze failures - categorize by severity
2. Fix critical issues first
3. Commit fixes: `git commit -m "fix: [description]"`
4. Re-run tests
5. Document remaining issues

### Git Workflow
```bash
# After integrating tests
git add backend/tests/establishments/
git commit -m "test: Add comprehensive test suite for Establishments System

- Add smoke tests for critical paths
- Add automated tests for all endpoints
- Add test data fixtures
- Add testing documentation"

# After fixing issues
git add backend/src/services/mediaService.js
git commit -m "fix: Correct tier limit calculation for exterior photos

Issue: Exterior photos were not counted against interior limit
Fix: Updated getMediaCountByType to include exterior in interior limit"

git push origin main
```

---

## 🎯 Success Criteria

**System is ready when:**
- ✅ Server starts without errors
- ✅ All smoke tests pass
- ✅ >90% automated tests pass
- ✅ No critical bugs blocking usage
- ✅ Cloudinary integration working
- ✅ File uploads working
- ✅ Validation catching bad input
- ✅ Ownership checks working
- ✅ Tier limits enforced

**Known acceptable failures:**
- Edge cases documented as limitations
- Performance tests (if response time still acceptable)
- Load tests (for production environment, not local)

---

## 📞 Need Help?

**Reference documents:**
- `HANDOFF_ESTABLISHMENTS.md` - Complete context and architecture
- `backend/ARCHITECTURE.md` - System architecture
- `backend/src/config/cloudinary.js` - Cloudinary documentation in comments

**Check commits:**
- `9f52767` - Phase One implementation
- `c4efddc` - Phase Two implementation

**Git log:**
```bash
git log --oneline -5
git show 9f52767  # See Phase One changes
git show c4efddc  # See Phase Two changes
```

---

**Good luck with testing! The code is solid. 🚀**

*Created: October 31, 2025*  
*For: Next Cursor IDE Session*  
*Context: Establishments System Testing Phase*

