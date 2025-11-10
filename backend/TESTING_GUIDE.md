# Testing Guide - Restaurant Guide Belarus Search System

This guide helps non-technical users test the search functionality using simple command-line tools and API testing. No programming knowledge required!

## Prerequisites

Before you begin, make sure you have:

1. ✅ Node.js installed (check by opening terminal and typing `node --version`)
2. ✅ PostgreSQL database running with the application
3. ✅ Backend server code in the `backend` folder

If you're missing any of these, ask a developer for help with setup.

---

## Part 1: Adding Test Data

The first step is to populate the database with realistic test establishments. This gives us data to search through.

### Step 1: Open Terminal

**On Windows:**
- Press `Win + R`
- Type `cmd` and press Enter

**On Mac:**
- Press `Cmd + Space`
- Type `Terminal` and press Enter

**On Linux:**
- Press `Ctrl + Alt + T`

### Step 2: Navigate to Backend Folder

In the terminal, type this command (adjust the path to where your project is):

```bash
cd /path/to/restaurant-guide-belarus/backend
```

For example:
- Windows: `cd C:\Projects\restaurant-guide-belarus\backend`
- Mac/Linux: `cd ~/Projects/restaurant-guide-belarus/backend`

### Step 3: Run the Seed Command

Type this command and press Enter:

```bash
npm run seed
```

### Step 4: What You Should See

You should see output like this:

```
═══════════════════════════════════════════════════════════
   🏪 Restaurant Guide Belarus - Data Seeding Script
═══════════════════════════════════════════════════════════

✅ Database connection successful

🧹 Clearing existing establishment data...
✅ Cleared 0 existing establishments

🌱 Seeding establishment test data...

✅ Created: Кафе "Центральное" (ID: 1)
   📍 Кофейня | Народная, Континентальная | $$
   ⭐ Rating: 4.5 (142 reviews) | Tier: standard

✅ Created: Ресторан "Минск" (ID: 2)
   📍 Ресторан | Народная | $$$
   ⭐ Rating: 4.7 (203 reviews) | Tier: premium

... (more establishments)

═══════════════════════════════════════════════════════════
✅ Successfully created: 30 establishments
═══════════════════════════════════════════════════════════

📊 Database Summary:
   Total establishments: 30

   By category:
     - Ресторан: 8
     - Кофейня: 7
     - Бар: 3
     ... (more categories)

✨ Seeding completed successfully!
You can now test search endpoints with realistic data.
```

**✅ Success!** If you see this output, the test data was created successfully.

**❌ Error?** If you see an error message:
1. Check that PostgreSQL is running
2. Check that database credentials are correct in `.env` file
3. Ask a developer for help

---

## Part 2: Viewing Database Statistics

You can check what data is in the database anytime.

### Quick Check

```bash
npm run count
```

This shows a summary of establishments by category, tier, price, etc.

### Detailed Statistics

```bash
npm run count -- --detailed
```

This shows additional information like top-rated establishments and feature statistics.

---

## Part 3: Testing Search Endpoints

Now let's test that the search API actually works! We'll use a tool called `curl` which comes pre-installed on most computers.

### First, Start the Backend Server

In a **new terminal window** (keep the first one open), navigate to the backend folder and start the server:

```bash
cd /path/to/restaurant-guide-belarus/backend
npm start
```

You should see:
```
Server running on port 3000
✅ Database connected
```

Leave this terminal window open with the server running.

### Test 1: Basic Search Near Minsk Center

In your **original terminal window**, run this command:

**Mac/Linux:**
```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=3000"
```

**Windows (PowerShell):**
```powershell
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=3000"
```

**What this does:** Searches for establishments within 3km of Minsk center (coordinates 53.9006, 27.5590).

**Expected result:** You should see JSON response with a list of establishments, sorted by our ranking algorithm.

### Test 2: Search with Category Filter

```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=5000&category=Ресторан,Кофейня"
```

**What this does:** Searches for restaurants and coffee shops within 5km.

**Expected result:** Only restaurants and coffee shops in the results.

### Test 3: Search with Price Range Filter

```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=5000&price_range=$,$$"
```

**What this does:** Searches for budget and moderate-priced establishments.

**Expected result:** Only establishments with price range $ or $$ in results.

### Test 4: Search with Multiple Filters

```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=5000&category=Ресторан&cuisine=Итальянская,Японская&features=wifi,delivery"
```

**What this does:** Searches for Italian or Japanese restaurants that have WiFi AND delivery.

**Expected result:** Only restaurants matching ALL criteria appear.

### Test 5: Map Bounds Search

```bash
curl "http://localhost:3000/api/v1/search/map?north=53.95&south=53.85&east=27.65&west=27.45"
```

**What this does:** Searches for establishments within a specific rectangular area on the map (bounding box around central Minsk).

**Expected result:** All establishments within those coordinates.

### Test 6: Test Pagination

```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=10000&page_size=5"
```

Look at the response and find the `cursor` value in the `pagination` object. Copy it, then run:

```bash
curl "http://localhost:3000/api/v1/search/establishments?lat=53.9006&lon=27.5590&radius=10000&page_size=5&cursor=PASTE_CURSOR_HERE"
```

**What this does:** Tests infinite scroll by fetching the next page of results.

**Expected result:** Different establishments on the second page (next 5 results).

---

## Part 4: Using Postman (Visual Testing)

If you prefer a graphical interface instead of command line, use Postman:

### Step 1: Install Postman

Download from https://www.postman.com/downloads/ and install.

### Step 2: Create a New Request

1. Open Postman
2. Click "New" → "HTTP Request"
3. Set method to `GET`
4. Enter URL: `http://localhost:3000/api/v1/search/establishments`

### Step 3: Add Query Parameters

Click on the "Params" tab and add parameters:

| Key | Value |
|-----|-------|
| lat | 53.9006 |
| lon | 27.5590 |
| radius | 3000 |

### Step 4: Send Request

Click the blue "Send" button. You should see the JSON response below.

### Step 5: Try Different Filters

Add more parameters to test different filters:

| Key | Value | Purpose |
|-----|-------|---------|
| category | Ресторан,Кофейня | Filter by categories |
| cuisine | Итальянская | Filter by cuisine |
| price_range | $$,$$$  | Filter by price |
| features | wifi,parking | Filter by features |
| hours_filter | until_22 | Filter by hours |

---

## Part 5: Verifying Ranking Algorithm

The ranking algorithm balances three factors. Let's verify it's working:

### Test: Compare Same Distance, Different Quality

1. Run a search with large radius (10km)
2. Look at results - establishments should NOT be sorted purely by distance
3. You should see high-quality establishments (high ratings, many reviews) ranked above lower-quality ones even if slightly farther

### Test: Compare Same Quality, Different Distance

1. Find two establishments with similar ratings in the results
2. The closer one should rank higher (all else being equal)

### Test: Subscription Tier Boost

1. Look for premium tier establishments in results
2. They should rank slightly higher than similar free tier establishments
3. But a great free tier establishment can still outrank a mediocre premium one

---

## Part 6: Common Issues and Solutions

### Issue: "Connection refused" error

**Solution:** Make sure the backend server is running (`npm start` in backend folder).

### Issue: "Database connection failed"

**Solution:** 
1. Check PostgreSQL is running
2. Verify `.env` file has correct database credentials
3. Try connecting to database manually with: `psql -U postgres -d restaurant_guide_belarus`

### Issue: "No results found"

**Solution:** 
1. Run `npm run count` to check if data exists
2. If count is 0, run `npm run seed` to add test data
3. Try increasing the radius parameter

### Issue: Seed script gives "relation does not exist" error

**Solution:** Database schema not created yet. Run migrations first:
```bash
npm run migrate
```

### Issue: Search returns establishments but in wrong order

**Solution:** This might be expected behavior. The ranking algorithm balances distance, quality, and subscription tier - not just distance alone.

---

## Part 7: Resetting Test Data

If you want to start fresh with new test data:

### Option 1: Clear and Re-seed (Safe)

```bash
npm run clear-data
npm run seed
```

### Option 2: Force Clear (No Confirmation)

```bash
node scripts/clear-establishments.js --force
npm run seed
```

---

## Understanding the Response Format

When you make a search request, you get back JSON data like this:

```json
{
  "success": true,
  "data": {
    "establishments": [
      {
        "id": 1,
        "name": "Кафе Центральное",
        "category": "Кофейня",
        "address": "пр-т Независимости, 18",
        "distance_meters": 234,
        "average_rating": 4.5,
        "review_count": 142,
        "price_range": "$$",
        "ranking_score": "87.42"
      }
    ],
    "pagination": {
      "cursor": "eyJyYW5raW5nU2NvcmUi...",
      "has_more": true,
      "page_size": 20
    }
  }
}
```

**Key fields explained:**
- `distance_meters`: How far the establishment is from search location (in meters)
- `ranking_score`: Combined score (0-100) used for sorting
- `cursor`: Use this to fetch the next page of results
- `has_more`: `true` if more results available, `false` if this is the last page

---

## Testing Checklist

Use this checklist to verify everything works:

- [ ] ✅ Test data seeded successfully (30 establishments)
- [ ] ✅ Basic search returns results near center
- [ ] ✅ Category filter works (only selected categories appear)
- [ ] ✅ Cuisine filter works (only selected cuisines appear)
- [ ] ✅ Price range filter works (only selected prices appear)
- [ ] ✅ Feature filters work (all required features present)
- [ ] ✅ Multiple filters combine correctly (AND logic between categories)
- [ ] ✅ Radius changes affect results (fewer results with smaller radius)
- [ ] ✅ Map bounds search returns establishments in area
- [ ] ✅ Pagination works (cursor fetches next page)
- [ ] ✅ Results ranked intelligently (not just by distance)
- [ ] ✅ 24-hour filter works (only 24-hour establishments)
- [ ] ✅ Operating hours filters work correctly

---

## Getting Help

If you encounter problems:

1. **Check the logs:** Look at the terminal where the backend server is running for error messages
2. **Verify data:** Run `npm run count` to make sure test data exists
3. **Check connection:** Ensure PostgreSQL and backend server are both running
4. **Ask developer:** Share the error message and which test failed

---

## Next Steps

Once basic search works:

1. **Test mobile app:** The mobile app should be able to call these same endpoints
2. **Test with real data:** Add real Minsk establishments instead of test data
3. **Performance testing:** Try searching with hundreds of establishments
4. **Edge cases:** Test with empty filters, invalid coordinates, etc.

Happy testing! 🚀

