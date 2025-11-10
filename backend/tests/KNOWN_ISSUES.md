# Known Issues and Workarounds

**Document Purpose:** Track known limitations, issues, and their workarounds  
**Last Updated:** October 31, 2025  
**Status:** Active Tracking

---

## Testing Environment Issues

### Issue #1: Windows PowerShell UTF-8 Encoding

**Severity:** LOW  
**Impact:** Automated tests fail when sending Cyrillic text  
**Discovered:** October 31, 2025  
**Status:** Won't Fix (External dependency issue)

**Description:**
Windows PowerShell 5.x does not properly encode UTF-8 Cyrillic characters when sending HTTP requests. This causes test data with Cyrillic text (Минск, Ресторан, Европейская) to be transmitted as "??????????" to the API, resulting in validation errors.

**Affected:**
- Windows PowerShell 5.x users running automated test scripts
- Only affects **testing**, not production use

**NOT Affected:**
- Production mobile apps
- Production web frontend
- Linux/Mac test environments  
- PowerShell 7+ (has proper UTF-8 support)
- WSL (Windows Subsystem for Linux)
- Git Bash

**Root Cause:**
PowerShell 5.x uses Windows-1251 code page by default for HTTP requests, not UTF-8.

**Workarounds:**

**Option 1: Use PowerShell 7+**
```powershell
# Install PowerShell 7
winget install Microsoft.PowerShell

# Run tests with PowerShell 7
pwsh -File test_establishments_simple.ps1
```

**Option 2: Use Bash Script on WSL**
```bash
# In WSL terminal
cd /mnt/c/Users/Honor/Restaurant_Guide_Belarus_v2/backend/tests
chmod +x test_establishments_api.sh
./test_establishments_api.sh
```

**Option 3: Use API Testing Tools**
- Postman
- Insomnia
- Bruno
- VS Code REST Client extension

**Option 4: Use curl in CMD (not PowerShell)**
```cmd
curl -X POST http://localhost:3000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"partner@test.com\",\"password\":\"test123\"}"
```

**Verification That System Works:**
Manual testing with proper UTF-8 encoding (Postman, curl on Linux) confirms all functionality works correctly. The API properly accepts and processes Cyrillic text.

---

## System Limitations (By Design)

### Limitation #1: Subscription Tier Upload Limits

**Type:** Business Rule (Not a Bug)  
**Status:** Working as Designed

**Description:**
Partners are limited in the number of photos they can upload based on their subscription tier:

| Tier | Interior Photos | Menu Photos |
|------|----------------|-------------|
| Free | 10 | 10 |
| Basic | 15 | 15 |
| Standard | 20 | 20 |
| Premium | 30 | 30 |

**Why This Exists:**
- Cloudinary storage costs scale with usage
- Encourages upgrades for serious partners
- Prevents abuse of free tier

**Workaround:**
None - this is intentional behavior. Partners must upgrade subscription tier for more photos.

**For Testing:**
Use `subscription_tier` field in establishments table to test different limits:
```sql
UPDATE establishments 
SET subscription_tier = 'premium' 
WHERE id = 'your-establishment-id';
```

---

### Limitation #2: Status Reset on Major Updates

**Type:** Business Rule (Not a Bug)  
**Status:** Working as Designed

**Description:**
When a partner updates certain "major" fields (name, categories, cuisines) on an active establishment, the status automatically resets to 'pending' and requires re-moderation.

**Affected Fields:**
- `name` - establishment name
- `categories` - establishment types
- `cuisines` - cuisine types

**Not Affected Fields (Minor Updates):**
- `description`
- `phone`
- `email`
- `website`
- `working_hours`
- `attributes`

**Why This Exists:**
- Prevents bait-and-switch tactics
- Ensures moderated information remains accurate
- Protects users from misleading listings

**Workaround:**
None - this is intentional behavior. Partners are warned when making major changes.

---

## Future Enhancements (Not Bugs)

### Enhancement #1: Bulk Operations

**Status:** Not Implemented (MVP Scope)  
**Priority:** Medium  
**Target:** Post-MVP

**Description:**
Currently, partners must update establishments one-by-one. No bulk operations exist for:
- Updating working hours across multiple establishments
- Updating contact information across multiple establishments
- Bulk status changes

**Impact:**
Partners with 5+ establishments find updates tedious.

**Workaround:**
Manual updates via API or mobile app, one establishment at a time.

**Future Implementation:**
Phase 3 feature - Bulk Operations API

---

### Enhancement #2: Media Reordering via Drag-and-Drop

**Status:** Not Implemented (MVP Scope)  
**Priority:** Low  
**Target:** Post-MVP

**Description:**
Photo reordering is done via `position` field updates. No drag-and-drop UI.

**Impact:**
With 20+ photos, reordering is tedious.

**Workaround:**
Update `position` field directly via API:
```json
PUT /partner/establishments/:id/media/:mediaId
{
  "position": 5
}
```

**Future Implementation:**
Mobile app will include drag-and-drop photo gallery.

---

## Resolved Issues

### ~~Issue: Partner Account Password Hash~~
**Status:** ✅ RESOLVED  
**Resolved:** October 31, 2025

**Description:**
Initial test partner account had incorrectly formatted password hash, causing authentication to fail with error: "pchstr must contain a $ as first char"

**Root Cause:**
SQL shell escaping of `$` character in argon2 hash when using `psql` directly.

**Resolution:**
Created Node.js script (`scripts/create-test-partner.js`) that properly generates and inserts password hashes using parameterized queries, avoiding escaping issues.

**Verification:**
Authentication now works correctly with test credentials.

---

## Testing Notes

### Note #1: Test Data Cleanup

**Recommendation:** Clean test data between test runs

**Why:**
- Prevents duplicate entries
- Ensures tests start from known state
- Avoids cascade failures

**How:**
```sql
-- Delete test establishments
DELETE FROM establishments WHERE partner_id IN (
  SELECT id FROM users WHERE email = 'partner@test.com'
);

-- Or reset entire test partner
DELETE FROM users WHERE email = 'partner@test.com';
-- Then recreate with create-test-partner.js
```

---

### Note #2: Rate Limiting

**Behavior:** API includes rate limiting for security

**Impact on Testing:**
Running tests repeatedly in quick succession may trigger rate limits (429 Too Many Requests).

**Workaround:**
- Wait 60 seconds between test runs
- Disable rate limiting in test environment (if needed)
- Use different partner accounts for parallel testing

---

### Note #3: Cloudinary Free Tier Limits

**Limitation:** Free Cloudinary accounts have monthly limits:
- 25 GB storage
- 25 GB bandwidth
- 25,000 transformations

**Impact on Testing:**
Extensive testing with real images can consume free tier quota.

**Workaround:**
- Use small test images (minimal JPEG)
- Delete test media from Cloudinary dashboard regularly
- Use separate Cloudinary account for testing

---

## Reporting New Issues

If you discover a new issue during testing, please document it here following this template:

```markdown
### Issue #X: [Brief Description]

**Severity:** [Critical / High / Medium / Low]  
**Impact:** [What functionality is affected]  
**Discovered:** [Date]  
**Status:** [Open / In Progress / Resolved]

**Description:**
[Detailed description of the issue]

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Expected vs Actual behavior]

**Workaround:**
[If available, how to work around the issue]

**Root Cause:**
[If known, what's causing the issue]

**Fix Status:**
[Plan for resolution or reason if won't fix]
```

---

## Contact & Support

**For Technical Issues:**
- Check `HANDOFF_ESTABLISHMENTS.md` for system architecture
- Review `TESTING_GUIDE.md` for testing procedures
- Consult `QUICK_START_CONTEXT.md` for quick reference

**For New Issues:**
1. Verify it's not already listed here
2. Reproduce the issue consistently
3. Document with the template above
4. Add to this document

---

**Document Maintained By:** Development Team  
**Last Review:** October 31, 2025  
**Next Review:** When new issues discovered

