# Establishments Management System - Manual Testing Guide

**Purpose:** Comprehensive testing procedures for scenarios requiring human judgment  
**Target Audience:** QA Engineers, Product Owners, Technical Leads  
**Prerequisites:** Backend deployed, mobile app or API client available, test accounts created  
**Last Updated:** October 2025

---

## Introduction: Why Manual Testing Matters

While automated tests excel at checking that APIs return correct status codes and data structures, they cannot evaluate the overall user experience or catch subtle issues that emerge from complex interactions between features. Manual testing fills this critical gap by verifying that the system works well from a real partner's perspective.

Think of automated tests as checking that all the ingredients are present in a recipe, while manual testing is actually cooking the dish and tasting it. Both are essential, but they serve different purposes.

This guide focuses on scenarios where human judgment is crucial: Does the error message make sense to a non-technical user? Does the workflow feel natural? Are there edge cases that break the expected behavior?

---

## Testing Environment Setup

Before beginning manual testing, establish a controlled test environment that mirrors production conditions while allowing safe experimentation.

### Test Accounts Required

You will need three types of test accounts to fully test the system:

**Partner Account 1 - "Fresh Partner"**
- Purpose: Test the complete onboarding flow from scratch
- Should have: Zero existing establishments
- Use for: First-time user experience, creation workflows

**Partner Account 2 - "Established Partner"**
- Purpose: Test management of existing establishments
- Should have: 2-3 establishments in various states (draft, pending, active)
- Should have: Multiple photos uploaded on at least one establishment
- Use for: Update workflows, media management, submission processes

**Admin Account**
- Purpose: Test moderation workflows and status transitions
- Should have: Admin role in database
- Use for: Approving submissions, viewing moderation queue
- Note: Admin functionality testing is outside this document's scope but needed for complete workflow testing

### Test Data Preparation

Prepare the following test assets before starting:

**Image Files:**
- High quality interior photo (3-5MB, typical smartphone resolution)
- High quality menu photo (similar size)
- Very large image (over 10MB) for limit testing
- Invalid file type (PDF, text file) for validation testing
- Corrupted image file for error handling testing

**Establishment Data Templates:**
Have prepared JSON or form data for common establishment types:
- Traditional Belarusian restaurant
- Modern fusion cuisine cafe
- Fast food establishment
- Bar with limited food menu

This preparation saves time and ensures consistent test data across test runs.

---

## Test Scenario 1: Complete Partner Onboarding Journey

**Objective:** Experience the system as a new partner would, identifying friction points and usability issues.

**Why This Matters:** First impressions determine whether partners will engage with the platform. If the onboarding experience is confusing or frustrating, partners will abandon the process, and the platform will fail to acquire content. This test validates that the "happy path" from account creation to published listing actually feels happy.

### Test Steps:

**1. Initial Establishment Creation**

Using your Fresh Partner account, create a new establishment through the mobile app or API client interface.

As you work through the creation form, pay attention to:

- **Field Labels:** Are they clear and unambiguous? Would a restaurant owner understand what "cuisines" means versus "categories"?
  
- **Input Validation Feedback:** When you enter invalid data (like coordinates outside Belarus), does the error message clearly explain what's wrong and how to fix it?

- **Progressive Disclosure:** Are you overwhelmed with too many fields at once, or is information requested in a logical sequence?

**Expected Observations:**
- The process should feel manageable, not overwhelming
- Required fields should be clearly marked
- Error messages should be helpful, not technical
- You should be able to save progress and return later (draft status)

**Red Flags:**
- Unclear error messages like "Validation failed" without specifics
- No way to partially complete and save
- Fields that are technically required but shouldn't be (like website for small local cafe)

**2. Media Upload Experience**

Upload multiple photos to your newly created establishment.

Test the following scenarios:

**Scenario A: Upload Interior Photos**
- Upload 3-5 interior photos showing different areas of your establishment
- Set one as the primary photo
- Observe: How clear is it which photo is primary? Can you easily change the primary photo?

**Scenario B: Upload Menu Photos**
- Upload 2-3 photos of menu pages or boards
- Add descriptive captions to help users understand what they're seeing
- Observe: Is it clear which photos are interior vs menu type? Does the categorization make sense?

**Scenario C: Reorder Photos**
- Try to change the order in which photos appear
- Observe: Is the reordering mechanism intuitive? Can you predict the order before saving?

**Scenario D: Test Upload Limits**
- Continue uploading until you hit the free tier limit (10 interior, 10 menu)
- Observe: Is the limit clearly communicated before you hit it? Is the error message helpful when you exceed it?

**Expected Observations:**
- Photo upload should be fast (under 5 seconds per photo on normal connection)
- Thumbnail generation should be immediate (shown while uploading)
- Primary photo should be visually distinct in the list
- Hitting limits should provide clear upgrade path information

**Red Flags:**
- Upload takes over 10 seconds without progress indication
- No visual feedback during upload (user doesn't know if it's working)
- Error on limit exceeded doesn't explain what the limit is or how to upgrade
- Photos appear in random order with no way to reorder

**3. Submission for Moderation**

Attempt to submit your establishment for moderation review.

Test these scenarios:

**Scenario A: Incomplete Submission Attempt**
- Try to submit before uploading required photos
- Expected: Clear error listing exactly what's missing
- Red Flag: Generic error or submission succeeds despite missing requirements

**Scenario B: Complete Submission**
- Upload all required media
- Complete all required fields
- Submit for moderation
- Expected: Clear confirmation that submission was received, estimated review time
- Red Flag: Submission succeeds but no feedback on what happens next

**Expected Observations:**
- Pre-submission validation should prevent wasting moderator time on incomplete listings
- The submission should feel like a milestone achievement, not a source of anxiety
- Partner should know what to expect: How long until review? Will they be notified?

**4. Post-Submission Updates**

After submission (status is 'pending'), try to make changes to your establishment.

Test scenarios:

**Scenario A: Minor Update During Moderation**
- Update the description or phone number
- Expected: Update succeeds, status remains 'pending'
- This allows partners to fix typos discovered after submission

**Scenario B: Major Update During Moderation**
- Try to change the establishment name or category
- Expected: Either blocked with explanation, or allowed with status reset warning
- Red Flag: Major change allowed without any indication it affects moderation status

**Expected Observations:**
- System should balance flexibility (allowing minor fixes) with integrity (preventing bait-and-switch)
- Partners should understand which changes are "safe" vs which trigger re-review

---

## Test Scenario 2: Establishment Management Workflows

**Objective:** Validate that partners can effectively manage multiple establishments and update them over time.

**Why This Matters:** Successful partners will grow beyond a single location. If managing multiple establishments is painful, the platform limits partner growth and loses enterprise clients. This test ensures the system scales with partner success.

### Test Steps:

**1. Dashboard Overview Testing**

Using your Established Partner account (with 2-3 existing establishments), access the establishment list/dashboard.

Evaluate the dashboard experience:

**Information Architecture:**
- Can you quickly scan and understand the status of all your establishments?
- Are key metrics (views, favorites, reviews) visible at a glance?
- Is it immediately obvious which establishments need attention?

**Test this by role-playing:** Imagine you're a busy restaurant manager checking the dashboard during a lunch rush break. You have 30 seconds. Can you:
- Identify which establishment has the most engagement?
- See if any establishments have pending actions?
- Find the establishment you need to update?

**Expected Observations:**
- Visual hierarchy makes important information stand out
- Status indicators use color coding effectively (draft, pending, active)
- Metrics are displayed in consistent format
- Search or filter helps find specific establishment quickly

**Red Flags:**
- All establishments look the same at first glance
- Have to open each establishment to see basic info
- Metrics are buried or require multiple clicks
- No way to filter by status

**2. Bulk Operations Testing**

If you manage 5+ establishments, certain tasks become tedious if done one-by-one.

Test these scenarios:

**Scenario A: Update Operating Hours for Holiday**
- Your restaurants will all close early on a holiday
- Try to update this across multiple establishments
- Current State: Likely requires editing each establishment individually
- Document: How long does this take? Is there obvious need for bulk update feature?

**Scenario B: Update Contact Information**
- Your business phone number changed
- Update this across establishments where applicable
- Document: Pain points in current workflow

**Expected Observations:**
- While bulk operations may not be implemented in MVP, you should note where they would provide significant value
- This feedback guides future feature prioritization

**3. Media Management at Scale**

Using an establishment with 15-20 photos uploaded, test media management:

**Scenario A: Find Specific Photo**
- Try to locate the photo of your bar area among many photos
- Is there search, filtering, or organization to help?
- How long does it take to find what you need?

**Scenario B: Reorganize Photo Display Order**
- Decide you want outdoor terrace photos first, then interior
- Reorder photos to match this vision
- How many clicks/drags does this require?

**Expected Observations:**
- With 5-10 photos, manual reordering is acceptable
- With 20+ photos, some organization/categorization becomes valuable
- Drag-and-drop should work smoothly without glitches

**Red Flags:**
- Photos load slowly when you have many
- Reordering requires refreshing the page to see results
- Deleting wrong photo by accident is too easy (no confirmation)

---

## Test Scenario 3: Edge Cases and Error Conditions

**Objective:** Identify how the system behaves under unusual or error conditions.

**Why This Matters:** Users don't always follow the expected path. Good systems gracefully handle mistakes and edge cases rather than crashing or leaving users stranded. This test ensures robustness and professional error handling.

### Test Cases:

**1. Concurrent Editing Conflicts**

**Setup:** Open the same establishment in two browser tabs or devices

**Test Scenarios:**

**Scenario A: Simultaneous Updates**
- Tab 1: Update description
- Tab 2: Update phone number
- Both submit around the same time
- Expected: Both updates should succeed (different fields) or last write wins with no data corruption
- Red Flag: One update silently lost, or database error

**Scenario B: Primary Photo Conflict**
- Tab 1: Set Photo A as primary
- Tab 2: Set Photo B as primary
- Both submit
- Expected: One succeeds, other potentially gets overridden, but only one photo ends up primary
- Red Flag: Both photos marked as primary, or neither is primary

**2. Network Interruption During Upload**

**Test Scenarios:**

**Scenario A: File Upload Interrupted**
- Start uploading a large image (5MB+)
- Disable network midway through upload
- Observe system behavior

**Expected Observations:**
- Clear error message indicating network problem
- Can retry upload without creating duplicate
- Partial upload is cleaned up (not left in temporary storage)

**Red Flags:**
- Upload appears to succeed but photo never appears
- Must recreate entire establishment due to failed upload
- Retry creates duplicate entries

**3. Invalid Data Scenarios**

**Scenario A: Malformed Working Hours**
- Try entering working hours like "10:00 AM to 22:00 PM" (mixing formats)
- Or: "25:00" (invalid hour)
- Expected: Validation catches this with helpful message
- Red Flag: Accepts invalid data, causing downstream errors

**Scenario B: Coordinates Outside Belarus**
- Enter latitude/longitude for a location in Poland or Russia (near borders)
- Expected: Clear error explaining coordinates must be within Belarus
- Red Flag: Accepts coordinates but establishment never appears in searches

**Scenario C: XSS/Injection Attempts**
- Enter `<script>alert('test')</script>` in description field
- Enter SQL-like syntax: `'; DROP TABLE establishments; --`
- Expected: Text is properly escaped/sanitized, rendered safely
- Red Flag: Script executes, or database error occurs

**4. Browser Compatibility Testing**

Test on multiple browsers and devices:

**Desktop Browsers:**
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Mobile Browsers:**
- iOS Safari
- Android Chrome

**For each, verify:**
- Forms work correctly
- File uploads function
- Photos display properly
- No console errors

**Document any browser-specific issues for development team**

---

## Test Scenario 4: Accessibility and Usability

**Objective:** Ensure the system is usable by partners with varying abilities and technical proficiency.

**Why This Matters:** Your partner base includes everyone from tech-savvy millennials to restaurant owners who prefer phone calls to emails. The system should be intuitive enough for the least technical user while not frustrating power users.

### Test Cases:

**1. Keyboard Navigation**

**Test:** Complete establishment creation using only keyboard (no mouse)

**Evaluate:**
- Can you tab through all form fields in logical order?
- Are focus indicators visible so you know where you are?
- Can you operate all interactive elements (buttons, dropdowns) via keyboard?
- Can you upload files using keyboard?

**Expected:** Entirely keyboard-operable for users with motor disabilities or power users who prefer keyboard

**2. Screen Reader Compatibility**

**Test (if available):** Use screen reader software (NVDA, JAWS, VoiceOver)

**Evaluate:**
- Are form labels announced correctly?
- Is image upload functionality described?
- Are error messages read aloud?
- Is the navigation structure clear?

**Expected:** All functionality available to screen reader users

**3. Low Digital Literacy Testing**

**Test:** Have someone unfamiliar with the system use it (colleague, friend, family member)

**Observe:**
- Where do they hesitate or get confused?
- What questions do they ask?
- Do they discover features intuitively or need help?
- What terms or concepts are unclear?

**This reveals assumptions developers made that aren't obvious to normal users**

**4. Mobile Responsiveness**

**Test:** Access partner dashboard on mobile device

**Evaluate:**
- Are all features accessible on mobile?
- Is text readable without zooming?
- Are buttons large enough to tap accurately?
- Does photo upload work from camera?
- Is navigation comfortable with one hand?

**Expected:** Core workflows possible on mobile, even if some advanced features are desktop-only

---

## Test Scenario 5: Data Integrity and Consistency

**Objective:** Verify that data remains consistent across operations and nothing gets corrupted or lost.

**Why This Matters:** Data integrity bugs are often subtle and only discovered after users have invested significant effort. A partner who loses hours of work due to a data integrity issue will likely abandon the platform and warn others.

### Test Cases:

**1. Media Deletion Verification**

**Test Sequence:**
1. Upload 5 photos to an establishment
2. Note the Cloudinary URLs returned
3. Delete one photo through the API/app
4. Wait 5 minutes (allow time for async operations)
5. Check Cloudinary dashboard - is the image actually deleted?
6. Try accessing the deleted image URL directly

**Expected:**
- Image is removed from database immediately
- Image is deleted from Cloudinary (may be async)
- Accessing deleted URL returns 404 after deletion completes

**Why This Matters:** If images aren't actually deleted from Cloudinary, the platform's storage costs will balloon and deleted content remains accessible via URL.

**2. Primary Photo Consistency**

**Test Sequence:**
1. Establishment has 5 photos, Photo A is primary
2. Delete Photo A
3. Check establishment - does it have a new primary photo automatically?
4. Upload new photo, set as primary
5. Check all other photos - are they correctly marked as non-primary?

**Expected:**
- At most one primary photo exists at any time
- If primary is deleted and other photos exist, one is auto-promoted
- Setting a new primary clears previous primary

**Why This Matters:** Multiple primary photos or zero primary photos creates UI confusion and search result issues.

**3. Status Transition Validation**

**Test various status transitions:**

**Valid transitions:**
- draft → pending (via submission)
- pending → active (via admin approval)
- active → pending (via major update)
- active → suspended (via admin action)

**Invalid transitions:**
- draft → active (must go through pending/moderation)
- suspended → active (must go through admin review)

**Test each transition and verify:**
- Valid transitions succeed
- Invalid transitions are blocked with clear error
- Status history is logged for audit trail

**Why This Matters:** Status controls what users see and what partners can do. Incorrect transitions can expose unapproved content or prevent partners from making legitimate changes.

---

## Test Scenario 6: Performance and Load

**Objective:** Identify performance bottlenecks and limitations before they affect users.

**Why This Matters:** A system that works perfectly with 10 establishments and 50 photos might struggle with 1000 establishments and 5000 photos. Performance testing identifies scalability issues early.

### Test Cases:

**1. Large Photo Upload**

**Test Sequence:**
- Upload a 10MB photo (at the limit)
- Measure upload time on typical connection
- Observe: Does the UI remain responsive? Is there progress indication?

**Acceptance Criteria:**
- Upload completes within 30 seconds on average connection
- Progress bar or spinner indicates activity
- Can cancel upload midway

**2. Dashboard with Many Establishments**

**Test Sequence:**
- Create partner account with 20+ establishments (use automated script)
- Load dashboard
- Measure page load time

**Expected:**
- Page loads in under 3 seconds
- Pagination prevents loading all establishments at once
- Search/filter remains responsive

**3. Media Gallery with Many Photos**

**Test Sequence:**
- Establishment with 30 photos (near premium tier limit)
- Load media gallery
- Scroll through all photos

**Expected:**
- Gallery loads progressively (lazy loading)
- Thumbnails load quickly, full images load on demand
- Scrolling remains smooth

---

## Reporting Issues Found During Manual Testing

When you discover an issue during manual testing, document it thoroughly so developers can reproduce and fix it.

### Issue Report Template:

**Issue Title:** [Concise description of problem]

**Severity:**
- Critical: System unusable or data loss
- High: Major feature broken
- Medium: Feature works but UX poor
- Low: Minor cosmetic issue

**Steps to Reproduce:**
1. [Specific step-by-step actions]
2. [Include data values used]
3. [Note any timing or sequence dependencies]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Environment:**
- Browser: [Chrome 95, Safari 15, etc.]
- Device: [Desktop, iPhone 12, etc.]
- User Account: [Partner ID or email]
- Establishment ID: [If applicable]

**Screenshots/Videos:**
[Attach visual evidence]

**Additional Context:**
[Any other relevant information]

---

## Manual Testing Checklist Summary

Use this checklist to track your testing progress:

### Onboarding Journey
- ☐ Complete establishment creation from blank slate
- ☐ Upload required media for submission
- ☐ Submit for moderation
- ☐ Verify post-submission behavior

### Management Workflows
- ☐ Dashboard overview with multiple establishments
- ☐ Update existing establishment details
- ☐ Manage media gallery (upload, reorder, delete)
- ☐ Change primary photo

### Edge Cases
- ☐ Concurrent editing scenarios
- ☐ Network interruption handling
- ☐ Invalid data validation
- ☐ Browser compatibility

### Accessibility
- ☐ Keyboard navigation
- ☐ Screen reader compatibility (if applicable)
- ☐ Low digital literacy testing
- ☐ Mobile responsiveness

### Data Integrity
- ☐ Media deletion verification
- ☐ Primary photo consistency
- ☐ Status transition validation

### Performance
- ☐ Large file upload
- ☐ Dashboard with many establishments
- ☐ Media gallery with many photos

---

## Conclusion

Manual testing complements automated testing by catching issues that only human judgment can identify. The goal is not to test every possible permutation (that's automation's job) but to experience the system as real users would and identify where the experience breaks down or confuses.

Your insights from manual testing directly improve the product and make the difference between a system that technically works and one that users actually enjoy using.

**Next Steps After Manual Testing:**
1. Compile all issues found into organized report
2. Prioritize issues by severity and frequency
3. Work with development team on fixes
4. Retest after fixes implemented
5. Document any workarounds for known issues

Good luck with your testing!

