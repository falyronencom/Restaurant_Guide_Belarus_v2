# Establishments Management System - Smoke Test Checklist

**Purpose:** Quick verification of critical functionality after deployment  
**Time Required:** 10-15 minutes  
**Prerequisites:** Backend server running, authenticated partner account available  
**Last Updated:** October 2025

---

## What is a Smoke Test?

A smoke test is a preliminary test to reveal simple failures severe enough to reject a software release. Think of it as checking if the lights turn on before testing every switch in a building. These tests focus on critical paths - the core functionality that absolutely must work for the system to be viable.

For the Establishments Management System, our critical paths are: creating establishments, uploading media, and submitting for moderation. If these three workflows function, the foundation is solid and we can proceed to detailed testing.

---

## Pre-Test Setup

Before beginning the smoke tests, ensure you have:

### Environment Configuration

**Backend Server Status:**
- Server is running on expected port (typically 3000 or 5000)
- Database connection is active and healthy
- Redis connection is working (for rate limiting)
- Cloudinary credentials are configured in environment variables

You can verify server health by calling the health check endpoint:
```bash
curl http://localhost:3000/api/v1/health
```

Expected response should show success and current timestamp.

### Test Account Preparation

**Partner Account Requirements:**
- A test user account with 'partner' role exists
- You have valid JWT authentication token for this partner
- The partner account has no existing establishments (fresh state preferred)

To obtain an authentication token, log in through the authentication endpoint and save the returned token. You will use this token in the Authorization header for all subsequent requests.

---

## Critical Path 1: Establishment Creation Flow

This test verifies partners can create new establishment listings, which is the entry point for all content in the system.

### Test Case 1.1: Create Basic Establishment (Draft Status)

**Objective:** Verify that a partner can successfully create a minimal valid establishment.

**Test Steps:**

1. Send POST request to `/api/v1/partner/establishments` with minimal required fields:
   - name: "Test Restaurant Минск"
   - city: "Минск"
   - address: "ул. Ленина 1"
   - latitude: 53.9045 (within Belarus bounds)
   - longitude: 27.5615 (within Belarus bounds)
   - categories: ["Ресторан"]
   - cuisines: ["Европейская"]
   - working_hours: Valid JSONB with daily schedule

2. Include Authorization header with partner JWT token

**Expected Results:**
- Response status: 201 Created
- Response contains establishment ID (UUID format)
- Status field is 'draft'
- All provided fields are saved correctly
- created_at timestamp is present
- partner_id matches authenticated user

**What This Tests:**
This validates the entire create workflow including authentication, authorization (partner role check), input validation, database insertion, and response formatting. If this passes, the core CRUD infrastructure is working.

**If Test Fails:**
- Check server logs for validation errors
- Verify coordinates are within Belarus bounds (lat: 51-56, lon: 23-33)
- Confirm city value exactly matches one of seven valid cities
- Ensure categories and cuisines arrays contain valid values

---

### Test Case 1.2: Verify Establishment Appears in Partner List

**Objective:** Confirm created establishment is retrievable and appears in partner's portfolio.

**Test Steps:**

1. Send GET request to `/api/v1/partner/establishments`
2. Include Authorization header with same partner token

**Expected Results:**
- Response status: 200 OK
- Response contains array with at least one establishment
- The newly created establishment appears in the list
- Pagination metadata is present (total, page, limit, pages)

**What This Tests:**
This validates the query functionality, ownership filtering (partner only sees their own establishments), and pagination logic. It confirms the database write from the previous test was successful and data retrieval works correctly.

---

### Test Case 1.3: Retrieve Single Establishment Details

**Objective:** Verify detailed establishment data can be fetched by ID.

**Test Steps:**

1. Use the establishment ID from Test 1.1
2. Send GET request to `/api/v1/partner/establishments/{id}`
3. Include Authorization header

**Expected Results:**
- Response status: 200 OK
- Response contains complete establishment object
- All fields match values from creation
- No data corruption or missing fields

**What This Tests:**
This validates the get-by-ID functionality and ownership verification. The service layer should check that the establishment belongs to the requesting partner before returning data.

---

## Critical Path 2: Media Upload and Management

This test verifies the Cloudinary integration and media management functionality, which is essential for partners to showcase their establishments.

### Test Case 2.1: Upload Interior Photo

**Objective:** Verify that media upload workflow functions end-to-end from file upload through Cloudinary to database storage.

**Test Steps:**

1. Prepare a test image file (JPEG, less than 10MB)
2. Send POST request to `/api/v1/partner/establishments/{id}/media` with multipart/form-data:
   - file: The test image
   - type: "interior"
   - caption: "Test interior photo"
   - is_primary: true

3. Include Authorization header

**Expected Results:**
- Response status: 201 Created
- Response contains media object with:
  - Three URLs (url, preview_url, thumbnail_url)
  - All URLs point to Cloudinary domain
  - URLs include optimization parameters (f_auto, q_auto, fl_progressive)
  - is_primary is true
  - position is set (likely 0 for first photo)

**What This Tests:**
This is the most complex workflow in the system. It validates:
- Multer file upload processing
- File type and size validation
- Cloudinary SDK integration and authentication
- Three-resolution URL generation with correct transformation parameters
- Database media record creation
- Primary photo logic

**If Test Fails:**
- Check Cloudinary credentials in environment variables
- Verify /tmp/uploads directory exists and is writable
- Ensure image file is valid JPEG/PNG and under 10MB
- Review server logs for Cloudinary API errors

---

### Test Case 2.2: Upload Menu Photo

**Objective:** Verify tier limits enforcement and multiple photo handling.

**Test Steps:**

1. Send POST request to `/api/v1/partner/establishments/{id}/media` with:
   - file: Different test image
   - type: "menu"
   - caption: "Test menu photo"
   - is_primary: false

**Expected Results:**
- Response status: 201 Created
- New media record created successfully
- Different URLs than first photo (different public_id)
- is_primary is false (first photo remains primary)

**What This Tests:**
This validates that multiple photos can be uploaded, different media types are handled correctly, and the primary photo logic works (only one primary at a time).

---

### Test Case 2.3: Verify Media List

**Objective:** Confirm uploaded media is retrievable.

**Test Steps:**

1. Send GET request to `/api/v1/partner/establishments/{id}/media`
2. Include Authorization header

**Expected Results:**
- Response status: 200 OK
- Array contains both uploaded photos
- Photos are ordered by position and creation date
- Primary photo is correctly marked

---

### Test Case 2.4: Verify Tier Limit Enforcement

**Objective:** Confirm upload limits are enforced based on subscription tier.

**Test Steps:**

1. Check establishment's subscription_tier (should be 'free' for test)
2. Attempt to upload 11 interior photos (free tier limit is 10)

**Expected Results:**
- First 10 uploads succeed with 201 status
- 11th upload fails with 403 Forbidden status
- Error message indicates limit exceeded and suggests upgrade

**What This Tests:**
This validates the business logic in the service layer that enforces subscription-based limits. This is critical for the monetization model.

---

## Critical Path 3: Submission and Status Transitions

This test verifies the moderation workflow, which is the gateway from draft content to published listings.

### Test Case 3.1: Attempt Submission Without Media (Should Fail)

**Objective:** Verify pre-submission validation prevents incomplete establishments from entering moderation queue.

**Test Steps:**

1. Create a new establishment (without uploading any media)
2. Send POST request to `/api/v1/partner/establishments/{id}/submit`
3. Include Authorization header

**Expected Results:**
- Response status: 400 Bad Request
- Error message indicates missing required media
- Status remains 'draft' (not changed to 'pending')

**What This Tests:**
This validates that the service layer performs comprehensive pre-submission checks. In production, we don't want partners submitting incomplete listings that waste moderator time.

**Note:** Currently, media validation is marked as TODO in Phase One code since media service didn't exist yet. After Phase Two integration, this validation should be active. If this test passes with the error message, media validation is working. If the submission succeeds despite missing media, the TODO needs to be implemented.

---

### Test Case 3.2: Successful Submission with Complete Information

**Objective:** Verify that a properly completed establishment can be submitted for moderation.

**Test Steps:**

1. Use the establishment from Critical Path 2 (has media uploaded)
2. Send POST request to `/api/v1/partner/establishments/{id}/submit`
3. Include Authorization header

**Expected Results:**
- Response status: 200 OK
- Response indicates status changed to 'pending'
- submitted_at timestamp is present
- Success message confirms submission

**What This Tests:**
This validates the complete happy path: establishment creation → media upload → submission. If this succeeds, the entire partner-facing content creation workflow is functional.

---

### Test Case 3.3: Verify Status in List View

**Objective:** Confirm status change is persisted and reflected in queries.

**Test Steps:**

1. Send GET request to `/api/v1/partner/establishments?status=pending`
2. Include Authorization header

**Expected Results:**
- Response contains the submitted establishment
- Status is 'pending'
- The submitted_at timestamp matches from previous test

---

## Critical Path 4: Update Operations

This test verifies partners can modify their establishments after creation.

### Test Case 4.1: Update Description (Minor Change)

**Objective:** Verify that minor field updates work without triggering status reset.

**Test Steps:**

1. Use establishment in 'pending' status from previous tests
2. Send PUT request to `/api/v1/partner/establishments/{id}` with:
   - description: "Updated description text"

**Expected Results:**
- Response status: 200 OK
- Description is updated
- Status remains 'pending' (minor change doesn't require re-moderation)
- updated_at timestamp is refreshed

**What This Tests:**
This validates the update logic and the business rule that minor changes don't disrupt the moderation workflow.

---

### Test Case 4.2: Update Name (Major Change)

**Objective:** Verify that major field changes trigger status reset to 'pending'.

**Test Steps:**

1. Change establishment status to 'active' (simulating approved establishment)
   - This requires admin action in real scenario, but for testing you can directly update database
   - UPDATE establishments SET status = 'active' WHERE id = '{id}'

2. Send PUT request to `/api/v1/partner/establishments/{id}` with:
   - name: "Completely New Restaurant Name"

**Expected Results:**
- Response status: 200 OK
- Name is updated
- **Status is reset from 'active' to 'pending'** (major change requires re-moderation)
- Message indicates re-submission required

**What This Tests:**
This validates the business rule that major changes (name, categories, cuisines) to active establishments require re-moderation. This protects against bait-and-switch scenarios where a partner gets approved then changes fundamental information.

---

## Critical Path 5: Media Management Operations

This test verifies partners can manage their uploaded photos.

### Test Case 5.1: Update Primary Photo

**Objective:** Verify primary photo can be changed.

**Test Steps:**

1. Use establishment with multiple photos from Critical Path 2
2. Get media list and identify a non-primary photo
3. Send PUT request to `/api/v1/partner/establishments/{id}/media/{mediaId}` with:
   - is_primary: true

**Expected Results:**
- Response status: 200 OK
- Selected photo now has is_primary: true
- When you fetch media list again, only one photo is primary (previous primary is now false)

**What This Tests:**
This validates the primary photo management logic that ensures only one primary photo per establishment.

---

### Test Case 5.2: Delete Non-Primary Photo

**Objective:** Verify media deletion works correctly.

**Test Steps:**

1. Identify a non-primary photo from the media list
2. Send DELETE request to `/api/v1/partner/establishments/{id}/media/{mediaId}`

**Expected Results:**
- Response status: 200 OK
- Success message confirms deletion
- When fetching media list, the photo is no longer present
- (Check Cloudinary dashboard to confirm image was deleted there too)

**What This Tests:**
This validates the deletion workflow including removal from both database and Cloudinary.

---

### Test Case 5.3: Delete Primary Photo

**Objective:** Verify automatic primary photo reassignment.

**Test Steps:**

1. Identify the current primary photo
2. Ensure there are other photos available
3. Send DELETE request to `/api/v1/partner/establishments/{id}/media/{primaryMediaId}`
4. Fetch media list again

**Expected Results:**
- Response status: 200 OK
- Deleted photo is removed
- Another photo is automatically set as primary (lowest position number)

**What This Tests:**
This validates the business logic that prevents establishments from having zero primary photos when media exists.

---

## Success Criteria Summary

The smoke test is considered **PASSED** if all critical paths complete successfully:

✅ **Critical Path 1:** Partner can create establishments and view their list  
✅ **Critical Path 2:** Partner can upload media with Cloudinary integration working  
✅ **Critical Path 3:** Submission workflow with validation functions correctly  
✅ **Critical Path 4:** Update operations work with proper status transitions  
✅ **Critical Path 5:** Media management operations function as expected

If all tests pass, the core functionality is working and you can proceed to comprehensive manual testing and eventually production deployment.

---

## What to Do if Tests Fail

**General Debugging Steps:**

1. Check server logs for detailed error messages and stack traces
2. Verify environment variables are correctly set (database, Cloudinary, JWT secret)
3. Confirm database schema matches the expected structure (run migrations)
4. Test database connectivity and Cloudinary credentials independently
5. Review validation error messages - they usually indicate exactly what's wrong

**Common Issues and Solutions:**

**Issue:** 401 Unauthorized on all requests  
**Solution:** Check JWT token is valid and not expired, verify Authorization header format is "Bearer {token}"

**Issue:** 403 Forbidden on partner endpoints  
**Solution:** Verify test user has 'partner' role in database, not just 'user' role

**Issue:** Cloudinary uploads fail  
**Solution:** Verify CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are correct in .env file

**Issue:** Database constraint violations  
**Solution:** Check that enum values (city, categories, cuisines) exactly match valid values including Cyrillic characters

**Issue:** File upload errors  
**Solution:** Ensure /tmp/uploads directory exists and has proper write permissions

---

## Next Steps After Smoke Test

Once the smoke test passes completely:

1. **Run Automated Test Script:** Execute the comprehensive automated tests that cover all endpoints systematically
2. **Perform Manual Testing:** Use the Manual Testing Guide to verify complex scenarios and edge cases
3. **Load Testing:** Test with realistic data volumes (many establishments, many photos)
4. **Security Testing:** Verify authorization properly prevents unauthorized access
5. **Integration Testing:** Test interaction with other system components (Search, Reviews, etc.)

Remember: passing smoke tests means the foundation is solid, but comprehensive testing is still needed before production release.

---

**Test Execution Date:** __________  
**Executed By:** __________  
**Test Result:** ☐ PASS  ☐ FAIL  
**Notes:** _______________________________________________________________

