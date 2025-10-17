# Reviews System Testing Guide

**Target Audience:** QA Testers, Product Team, Founder  
**Project:** Restaurant Guide Belarus v2.0  
**Feature:** User Reviews System  
**Date:** October 16, 2025  
**Testing Level:** Manual Smoke Tests and Core Workflows

---

## Introduction

This guide helps you test the Reviews System Backend after it has been integrated into the Restaurant Guide Belarus codebase. You do not need programming experience to follow these instructions. All tests use curl commands that you can copy and paste into your terminal.

The Reviews System allows authenticated users to write, read, update, and delete reviews for restaurants and other establishments. Reviews include a one-to-five star rating and text content. The system enforces rate limits (ten reviews per day per user) and ensures only review authors can modify or delete their reviews.

---

## Prerequisites Before Testing

Before you can test the reviews system, ensure the following components are running and configured:

**Backend Server Running:** Open a terminal and navigate to the backend directory. Start the development server with `npm run dev` or the command your team uses. The server should start successfully and display a message like "Server running on port 5000." Keep this terminal window open while testing.

**Database Configured:** The PostgreSQL database should be running and include the reviews table with proper schema. The database should also have at least one test user account and one test establishment that you can use for testing. If you need to create test data, coordinate with your development team.

**Redis Running:** The Redis server should be running for rate limiting functionality. You can verify Redis is running by opening a new terminal and typing `redis-cli ping`. If Redis responds with "PONG," it is working correctly.

**Authentication Working:** You should be able to log in and obtain a valid access token. The reviews system uses the same authentication system as other features, so if authentication is working for other parts of the app, it will work for reviews too.

---

## Getting an Access Token

Most review operations require authentication. Before testing authenticated endpoints, you need to obtain an access token by logging in.

**Command:**

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+375291234567",
    "password": "your_password_here"
  }'
```

Replace the phone number and password with actual test account credentials from your database.

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "abc123...",
      "phone_number": "+375291234567",
      "name": "Test User"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
}
```

Copy the `accessToken` value from the response. You will use this token in subsequent authenticated requests by replacing `YOUR_ACCESS_TOKEN` in the examples below.

---

## Core Testing Scenarios

### Scenario One: Create a Review

This tests the core functionality of writing a review for an establishment. The user must be authenticated and the establishment must exist in the database.

**Command:**

```bash
curl -X POST http://localhost:5000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "establishment_id": "your-establishment-uuid-here",
    "rating": 5,
    "content": "Amazing food and atmosphere! The draniki were perfectly crispy and the service was excellent. Will definitely come back."
  }'
```

Replace `YOUR_ACCESS_TOKEN` with your actual token from login. Replace `your-establishment-uuid-here` with a real establishment ID from your database (ask your development team for a test establishment ID if needed).

**Expected Result:** The API responds with HTTP status 201 Created and returns the newly created review object with an ID, timestamps, and author information.

**What to Check:** The review ID is a valid UUID. The rating matches what you sent (5). The content matches your text exactly. The created_at and updated_at timestamps are recent. The author information includes the logged-in user's name.

**Common Issues:** If you get a 400 error with "Establishment not found," the establishment ID you used does not exist in the database. If you get a 401 error, your access token is invalid or expired. If you get a 409 error with "Duplicate review," you already wrote a review for this establishment and need to update it instead.

### Scenario Two: Read a Review

This tests retrieving a specific review by its ID. This endpoint is public, so no authentication is required.

**Command:**

```bash
curl http://localhost:5000/api/v1/reviews/YOUR_REVIEW_ID
```

Replace `YOUR_REVIEW_ID` with the ID from the review you created in Scenario One.

**Expected Result:** The API responds with HTTP status 200 OK and returns the review object with all its details.

**What to Check:** The review data matches what you created. The author information is included. No sensitive data like the author's phone number or password appears in the response.

**Common Issues:** If you get a 404 error with "Review not found," the review ID is incorrect or the review was deleted.

### Scenario Three: Get All Reviews for an Establishment

This tests retrieving all reviews for a specific establishment with pagination. This endpoint is public.

**Command:**

```bash
curl "http://localhost:5000/api/v1/reviews/establishments/YOUR_ESTABLISHMENT_ID/reviews?page=1&limit=5&sort=newest"
```

Replace `YOUR_ESTABLISHMENT_ID` with a real establishment ID. The query parameters control pagination and sorting: page is the page number (starting from 1), limit is how many results per page (maximum 50), and sort can be "newest" (most recent first), "highest" (highest ratings first), or "lowest" (lowest ratings first).

**Expected Result:** The API responds with HTTP status 200 OK and returns an object containing a reviews array and pagination metadata.

**What to Check:** The reviews array contains review objects, each with rating, content, author info, and timestamps. The pagination object shows the current page, total number of reviews, total pages, and whether there are more pages (hasNext, hasPrevious). If you request page 1 and there are only three reviews total, hasNext should be false.

**Common Issues:** If you get a 404 error, the establishment ID is incorrect. If the reviews array is empty, the establishment exists but has no reviews yet (this is expected for new establishments).

### Scenario Four: Update Your Review

This tests modifying an existing review. Only the review author can update their review.

**Command:**

```bash
curl -X PUT http://localhost:5000/api/v1/reviews/YOUR_REVIEW_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "rating": 4,
    "content": "Good food, but the service was a bit slow today. Still recommend it overall."
  }'
```

Replace `YOUR_REVIEW_ID` with the ID of a review you created. Replace `YOUR_ACCESS_TOKEN` with your valid token.

**Expected Result:** The API responds with HTTP status 200 OK and returns the updated review object.

**What to Check:** The rating changed to 4. The content updated to the new text. The updated_at timestamp is newer than created_at. The is_edited field is true, indicating this review has been modified. The created_at timestamp did not change (reviews keep their original creation date even after editing).

**Common Issues:** If you get a 403 error with "Unauthorized," you are trying to update someone else's review (only authors can modify their reviews). If you get a 404 error, the review ID is incorrect or the review was deleted.

### Scenario Five: Delete Your Review

This tests soft-deleting a review. Only the review author can delete their review. Deleted reviews are hidden from public view but preserved in the database.

**Command:**

```bash
curl -X DELETE http://localhost:5000/api/v1/reviews/YOUR_REVIEW_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Replace `YOUR_REVIEW_ID` with the ID of a review you created. Replace `YOUR_ACCESS_TOKEN` with your valid token.

**Expected Result:** The API responds with HTTP status 200 OK and returns a success message.

**What to Check:** After deletion, if you try to read this review using the GET endpoint from Scenario Two, you should get a 404 error because deleted reviews are hidden. If you try to create a new review for the same establishment, it should succeed because the old review is no longer active.

**Common Issues:** Same authorization issues as Scenario Four apply. Only the review author can delete their review.

### Scenario Six: Check Review Quota

This tests checking how many reviews the authenticated user can still create today. The system limits users to ten reviews per day to prevent spam.

**Command:**

```bash
curl http://localhost:5000/api/v1/reviews/quota \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Replace `YOUR_ACCESS_TOKEN` with your valid token.

**Expected Result:** The API responds with HTTP status 200 OK and returns quota information.

**What to Check:** The quota object shows how many reviews you have remaining today. If you just created one review in Scenario One, the remaining count should be 9 (since the daily limit is 10). If you have created ten reviews today, the remaining count should be 0.

---

## Testing Edge Cases

After verifying the core scenarios work, test these edge cases to ensure the system handles errors gracefully.

### Invalid Rating Values

Try creating a review with a rating outside the 1-5 range:

```bash
curl -X POST http://localhost:5000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "establishment_id": "your-establishment-uuid",
    "rating": 6,
    "content": "Testing invalid rating"
  }'
```

**Expected Result:** The API responds with HTTP status 400 Bad Request and a validation error message explaining that rating must be between 1 and 5.

### Content Too Short

Try creating a review with very short content:

```bash
curl -X POST http://localhost:5000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "establishment_id": "your-establishment-uuid",
    "rating": 5,
    "content": "Good"
  }'
```

**Expected Result:** The API responds with HTTP status 400 Bad Request and a validation error explaining that content must be at least 10 characters long.

### Duplicate Review

Try creating a second review for the same establishment without deleting the first:

**Expected Result:** The API responds with HTTP status 409 Conflict and an error message saying "You already have an active review for this establishment." Users can only have one active review per establishment.

### Rate Limit Exceeded

Create eleven reviews in rapid succession (you may need multiple test establishments for this). On the eleventh attempt, you should hit the rate limit.

**Expected Result:** The API responds with HTTP status 429 Too Many Requests and an error message saying "Review rate limit exceeded. You can create 10 reviews per day. Try again later."

---

## Troubleshooting Common Issues

**Issue:** curl command returns "Could not resolve host"  
**Solution:** Check that your backend server is running on the expected host and port. The default is localhost:5000 but your configuration might differ.

**Issue:** All authenticated endpoints return 401 Unauthorized  
**Solution:** Your access token is invalid or expired. Get a fresh token by logging in again using the command from the "Getting an Access Token" section.

**Issue:** POST requests return 400 with "Invalid JSON"  
**Solution:** Check that your curl command includes the backslashes at the end of each line for line continuation. If you are copying commands, ensure no extra spaces or characters were added. Alternatively, put the entire command on one line without backslashes.

**Issue:** Review creation returns 404 "Establishment not found"  
**Solution:** The establishment ID you are using does not exist in the database. Ask your development team for a valid test establishment ID, or create test establishments in the database first.

**Issue:** Tests work but reviews do not appear in the mobile app  
**Solution:** The backend API is working correctly. The issue is likely in the frontend integration. Coordinate with mobile developers to debug the app's API consumption.

---

## Success Checklist

Use this checklist to verify complete testing coverage:

- [ ] Can create a review with valid data and get back a review object with ID
- [ ] Can read a specific review by ID and see all expected fields
- [ ] Can retrieve all reviews for an establishment with pagination working
- [ ] Can update a review I created and see the changes reflected
- [ ] Can delete a review I created and confirm it becomes inaccessible
- [ ] Can check my review quota and see the remaining count decrease after creating reviews
- [ ] Invalid rating values are rejected with clear error messages
- [ ] Content that is too short is rejected with clear error messages
- [ ] Cannot create duplicate reviews for the same establishment
- [ ] Rate limiting works correctly after creating ten reviews
- [ ] Cannot update or delete reviews created by other users
- [ ] Public endpoints (read review, get establishment reviews) work without authentication
- [ ] Authenticated endpoints require valid access tokens

When all items are checked, the Reviews System has passed basic smoke testing and is ready for frontend integration and more comprehensive QA testing.

---

## Next Steps

After completing these tests successfully, the following activities can proceed:

**Frontend Integration Testing:** Work with mobile developers to test the same workflows through the mobile app interface instead of curl commands. Verify that creating, reading, updating, and deleting reviews works correctly from the app.

**Comprehensive Test Suite:** If your team has automated tests or more detailed test plans, execute those to cover additional scenarios beyond these basic smoke tests.

**User Acceptance Testing:** Have actual potential users (not just the development team) try the reviews feature and provide feedback on the user experience, clarity of error messages, and overall functionality.

**Production Deployment:** Once all testing passes and the team is confident in the reviews system quality, proceed with deploying to production following your standard deployment procedures.

---

**Testing Guide Version:** 1.0  
**Date:** October 16, 2025  
**Document Status:** Ready for QA Team

