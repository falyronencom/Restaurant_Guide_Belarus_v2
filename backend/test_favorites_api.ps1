# ============================================================================
# Favorites System API Automated Test Script (PowerShell)
# ============================================================================
# Purpose: Automated testing of Favorites System endpoints
# Target: Restaurant Guide Belarus Backend API v1
# Platform: Windows PowerShell
# ============================================================================

$ErrorActionPreference = "Continue"

# Configuration
$API_BASE = "http://localhost:5000/api/v1"
$TEST_EMAIL = "favorites.test@example.com"
$TEST_PASSWORD = "TestPass123"
$ESTABLISHMENT_ID = "21c7cb88-b88b-4a67-ae6e-d42efd5daf2a"  # Центральная кофейня

# Test counters
$script:TESTS_RUN = 0
$script:TESTS_PASSED = 0
$script:TESTS_FAILED = 0

# Store tokens
$script:ACCESS_TOKEN = ""
$script:USER_ID = ""

# ============================================================================
# Helper Functions
# ============================================================================

function Write-TestHeader {
    param([string]$Title)
    Write-Host "`n========================================" -ForegroundColor Blue
    Write-Host $Title -ForegroundColor Blue
    Write-Host "========================================`n" -ForegroundColor Blue
}

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Message = ""
    )
    
    $script:TESTS_RUN++
    
    if ($Passed) {
        $script:TESTS_PASSED++
        Write-Host "✓ PASS" -ForegroundColor Green -NoNewline
        Write-Host " - $TestName"
        if ($Message) {
            Write-Host "  $Message" -ForegroundColor Gray
        }
    } else {
        $script:TESTS_FAILED++
        Write-Host "✗ FAIL" -ForegroundColor Red -NoNewline
        Write-Host " - $TestName"
        if ($Message) {
            Write-Host "  $Message" -ForegroundColor Red
        }
    }
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ INFO" -ForegroundColor Cyan -NoNewline
    Write-Host " - $Message"
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ WARNING" -ForegroundColor Yellow -NoNewline
    Write-Host " - $Message"
}

# ============================================================================
# Pre-Test Checks
# ============================================================================

Write-TestHeader "PRE-TEST CHECKS"

Write-Info "Checking if backend server is running..."
try {
    $healthResponse = Invoke-RestMethod -Uri "$API_BASE/health" -Method GET
    Write-TestResult "Backend server health check" $true "Server is running and healthy"
} catch {
    Write-TestResult "Backend server health check" $false "Server not responding. Start with 'npm run dev'"
    Write-Host "`nCRITICAL ERROR: Cannot proceed. Backend server must be running." -ForegroundColor Red
    exit 1
}

Write-Warning "This script will create test data in your database. Use development database."

# ============================================================================
# Authentication Setup
# ============================================================================

Write-TestHeader "AUTHENTICATION SETUP"

Write-Info "Attempting to login with test credentials..."
try {
    $loginBody = @{
        email = $TEST_EMAIL
        password = $TEST_PASSWORD
    } | ConvertTo-Json
    
    $loginResponse = Invoke-RestMethod -Uri "$API_BASE/auth/login" `
        -Method POST `
        -Headers @{"Content-Type"="application/json"} `
        -Body $loginBody
    
    $script:ACCESS_TOKEN = $loginResponse.data.accessToken
    $script:USER_ID = $loginResponse.data.user.id
    Write-TestResult "User authentication" $true "Successfully authenticated"
    Write-Info "User ID: $script:USER_ID"
} catch {
    Write-TestResult "User authentication" $false "Login failed. User already exists from smoke tests."
    Write-Info "Using existing test user from smoke tests"
    $script:USER_ID = "df8fed96-f34d-4286-aba8-78a591ef8ffe"
    $script:ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkZjhmZWQ5Ni1mMzRkLTQyODYtYWJhOC03OGE1OTFlZjhmZmUiLCJlbWFpbCI6ImZhdm9yaXRlcy50ZXN0QGV4YW1wbGUuY29tIiwicm9sZSI6InVzZXIiLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzYxMjMwNTg0LCJleHAiOjE3NjEyMzE0ODQsImF1ZCI6InJlc3RhdXJhbnQtZ3VpZGUtYXBpIiwiaXNzIjoicmVzdGF1cmFudC1ndWlkZS1iZWxhcnVzIn0.uss_xM4Ce4MetFDISNOniwuuIi1wmMHSvEA5pARWUgc"
}

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $script:ACCESS_TOKEN"
}

Write-Info "Using establishment ID: $ESTABLISHMENT_ID"

# ============================================================================
# Test 1: Add Favorite (Happy Path)
# ============================================================================

Write-TestHeader "TEST 1: ADD FAVORITE (HAPPY PATH)"

Write-Info "Testing POST /api/v1/favorites"
try {
    $body = @{establishment_id = $ESTABLISHMENT_ID} | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites" `
        -Method POST `
        -Headers $headers `
        -Body $body
    
    $favoriteId = $response.data.id
    Write-TestResult "Add favorite - Status 201" $true "Favorite created successfully"
    Write-Info "Favorite ID: $favoriteId"
    
    if ($favoriteId) {
        Write-TestResult "Add favorite - Response contains ID" $true
    } else {
        Write-TestResult "Add favorite - Response contains ID" $false "Missing favorite ID"
    }
} catch {
    Write-TestResult "Add favorite - Status 201" $false "Request failed: $($_.Exception.Message)"
}

# ============================================================================
# Test 2: Add Favorite (Idempotency)
# ============================================================================

Write-TestHeader "TEST 2: ADD FAVORITE (IDEMPOTENCY)"

Write-Info "Testing idempotent behavior - adding same establishment again"
try {
    $body = @{establishment_id = $ESTABLISHMENT_ID} | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites" `
        -Method POST `
        -Headers $headers `
        -Body $body
    
    Write-TestResult "Add duplicate favorite - Idempotent" $true "Operation succeeded without error"
} catch {
    Write-TestResult "Add duplicate favorite - Idempotent" $false "Should succeed idempotently"
}

# ============================================================================
# Test 3: Get User Favorites (Happy Path)
# ============================================================================

Write-TestHeader "TEST 3: GET USER FAVORITES"

Write-Info "Testing GET /api/v1/favorites"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites" `
        -Method GET `
        -Headers $headers
    
    Write-TestResult "Get favorites - Status 200" $true
    
    if ($response.data.favorites) {
        Write-TestResult "Get favorites - Contains favorites array" $true
        
        $found = $false
        foreach ($fav in $response.data.favorites) {
            if ($fav.establishment_id -eq $ESTABLISHMENT_ID) {
                $found = $true
                break
            }
        }
        Write-TestResult "Get favorites - Contains added favorite" $found
        
        if ($response.data.pagination) {
            Write-TestResult "Get favorites - Contains pagination" $true
        } else {
            Write-TestResult "Get favorites - Contains pagination" $false
        }
    } else {
        Write-TestResult "Get favorites - Contains favorites array" $false
    }
} catch {
    Write-TestResult "Get favorites - Status 200" $false "Request failed: $($_.Exception.Message)"
}

# ============================================================================
# Test 4: Get Favorites with Pagination
# ============================================================================

Write-TestHeader "TEST 4: GET FAVORITES WITH PAGINATION"

Write-Info "Testing GET /api/v1/favorites?page=1&limit=5"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites?page=1&limit=5" `
        -Method GET `
        -Headers $headers
    
    Write-TestResult "Pagination - Status 200" $true
    
    if ($response.data.pagination.page -eq 1 -and $response.data.pagination.limit -eq 5) {
        Write-TestResult "Pagination - Parameters respected" $true
    } else {
        Write-TestResult "Pagination - Parameters respected" $false
    }
} catch {
    Write-TestResult "Pagination - Status 200" $false
}

# ============================================================================
# Test 5: Check Favorite Status (Happy Path)
# ============================================================================

Write-TestHeader "TEST 5: CHECK FAVORITE STATUS"

Write-Info "Testing GET /api/v1/favorites/check/$ESTABLISHMENT_ID"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites/check/$ESTABLISHMENT_ID" `
        -Method GET `
        -Headers $headers
    
    Write-TestResult "Check status - Status 200" $true
    
    if ($response.data.is_favorite -eq $true) {
        Write-TestResult "Check status - Returns is_favorite: true" $true
    } else {
        Write-TestResult "Check status - Returns is_favorite: true" $false "Expected true, got $($response.data.is_favorite)"
    }
} catch {
    Write-TestResult "Check status - Status 200" $false
}

# ============================================================================
# Test 6: Batch Check Favorite Status
# ============================================================================

Write-TestHeader "TEST 6: BATCH CHECK FAVORITE STATUS"

Write-Info "Testing POST /api/v1/favorites/check-batch"
try {
    $batchBody = @{
        establishment_ids = @($ESTABLISHMENT_ID, "00000000-0000-0000-0000-000000000002")
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites/check-batch" `
        -Method POST `
        -Headers $headers `
        -Body $batchBody
    
    Write-TestResult "Batch check - Status 200" $true
    
    if ($response.data.favorites) {
        Write-TestResult "Batch check - Contains favorites mapping" $true
    } else {
        Write-TestResult "Batch check - Contains favorites mapping" $false
    }
} catch {
    Write-TestResult "Batch check - Status 200" $false
}

# ============================================================================
# Test 7: Remove Favorite (Happy Path)
# ============================================================================

Write-TestHeader "TEST 7: REMOVE FAVORITE"

Write-Info "Testing DELETE /api/v1/favorites/$ESTABLISHMENT_ID"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites/$ESTABLISHMENT_ID" `
        -Method DELETE `
        -Headers $headers
    
    Write-TestResult "Remove favorite - Status 200" $true "Favorite removed successfully"
    
    # Verify removal
    Start-Sleep -Milliseconds 500
    $checkResponse = Invoke-RestMethod -Uri "$API_BASE/favorites/check/$ESTABLISHMENT_ID" `
        -Method GET `
        -Headers $headers
    
    if ($checkResponse.data.is_favorite -eq $false) {
        Write-TestResult "Remove favorite - Verification" $true "Status is now false"
    } else {
        Write-TestResult "Remove favorite - Verification" $false "Still appears favorited"
    }
} catch {
    Write-TestResult "Remove favorite - Status 200" $false
}

# ============================================================================
# Test 8: Remove Favorite (Idempotency)
# ============================================================================

Write-TestHeader "TEST 8: REMOVE FAVORITE (IDEMPOTENCY)"

Write-Info "Testing idempotent remove - removing again"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites/$ESTABLISHMENT_ID" `
        -Method DELETE `
        -Headers $headers
    
    Write-TestResult "Remove non-existent - Idempotent" $true "Succeeded without error"
} catch {
    Write-TestResult "Remove non-existent - Idempotent" $false
}

# ============================================================================
# Test 9: Missing Authentication
# ============================================================================

Write-TestHeader "TEST 9: ERROR HANDLING - MISSING AUTH"

Write-Info "Testing without auth token - should return 401"
try {
    $body = @{establishment_id = $ESTABLISHMENT_ID} | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites" `
        -Method POST `
        -Headers @{"Content-Type"="application/json"} `
        -Body $body
    
    Write-TestResult "Missing auth - Status 401" $false "Should have rejected"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-TestResult "Missing auth - Status 401" $true "Correctly rejected"
    } else {
        Write-TestResult "Missing auth - Status 401" $false "Wrong status code"
    }
}

# ============================================================================
# Test 10: Invalid UUID Format
# ============================================================================

Write-TestHeader "TEST 10: ERROR HANDLING - INVALID UUID"

Write-Info "Testing with invalid UUID format"
try {
    $body = @{establishment_id = "not-a-uuid"} | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites" `
        -Method POST `
        -Headers $headers `
        -Body $body
    
    Write-TestResult "Invalid UUID - Validation" $false "Should have rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 422 -or $statusCode -eq 400) {
        Write-TestResult "Invalid UUID - Validation" $true "Correctly rejected"
    } else {
        Write-TestResult "Invalid UUID - Validation" $false "Expected 422/400, got $statusCode"
    }
}

# ============================================================================
# Test 11: Invalid Pagination
# ============================================================================

Write-TestHeader "TEST 11: ERROR HANDLING - INVALID PAGINATION"

Write-Info "Testing with invalid pagination (page=0, limit=100)"
try {
    $response = Invoke-RestMethod -Uri "$API_BASE/favorites?page=0&limit=100" `
        -Method GET `
        -Headers $headers
    
    Write-TestResult "Invalid pagination - Validation" $false "Should have rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400 -or $statusCode -eq 422) {
        Write-TestResult "Invalid pagination - Validation" $true "Correctly rejected"
    } else {
        Write-TestResult "Invalid pagination - Validation" $false
    }
}

# ============================================================================
# Test Summary
# ============================================================================

Write-TestHeader "TEST SUMMARY"

Write-Host "Tests Run:    " -NoNewline
Write-Host $script:TESTS_RUN -ForegroundColor Blue

Write-Host "Tests Passed: " -NoNewline
Write-Host $script:TESTS_PASSED -ForegroundColor Green

Write-Host "Tests Failed: " -NoNewline
Write-Host $script:TESTS_FAILED -ForegroundColor Red

Write-Host ""

if ($script:TESTS_FAILED -eq 0) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "ALL TESTS PASSED ✓" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "The Favorites System is working correctly!" -ForegroundColor Green
    Write-Host "All endpoints are responding as expected." -ForegroundColor Green
    exit 0
} else {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "SOME TESTS FAILED ✗" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please review the failed tests above." -ForegroundColor Yellow
    exit 1
}

