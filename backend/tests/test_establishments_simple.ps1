# Simplified Establishments API Test Script
# Windows PowerShell compatible version

param(
    [string]$ApiBaseUrl = "http://localhost:3000/api/v1",
    [string]$PartnerEmail = "partner@test.com",
    [string]$PartnerPassword = "test123"
)

$script:TotalTests = 0
$script:PassedTests = 0
$script:FailedTests = 0
$script:AuthToken = ""
$script:EstablishmentId = ""

function Write-TestInfo { 
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-TestPass { 
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
    $script:PassedTests++
}

function Write-TestFail { 
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:FailedTests++
}

function Start-Test {
    param([string]$Description)
    $script:TotalTests++
    Write-TestInfo "Test $($script:TotalTests): $Description"
}

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "  Establishments API Test - Simplified Version" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Start-Test "API Health Check"
try {
    $response = Invoke-RestMethod -Uri "$ApiBaseUrl/health" -Method GET
    if ($response.success) {
        Write-TestPass "API is healthy and responding"
    } else {
        Write-TestFail "API returned success=false"
    }
} catch {
    Write-TestFail "Cannot connect to API: $_"
    exit 1
}

# Test 2: Authentication
Start-Test "Partner Authentication"
try {
    $loginData = @{
        email = $PartnerEmail
        password = $PartnerPassword
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$ApiBaseUrl/auth/login" -Method POST -Body $loginData -ContentType "application/json"
    
    if ($response.success -and $response.data.accessToken) {
        $script:AuthToken = $response.data.accessToken
        Write-TestPass "Authentication successful"
    } else {
        Write-TestFail "Authentication failed"
        exit 1
    }
} catch {
    Write-TestFail "Authentication error: $_"
    exit 1
}

# Test 3: Create Establishment
Start-Test "Create New Establishment"
try {
    $establishmentData = @{
        name = "Test Restaurant"
        description = "Automated test establishment"
        city = "Минск"
        address = "пр. Независимости 1"
        latitude = 53.9045
        longitude = 27.5615
        phone = "+375291234567"
        email = "test@restaurant.by"
        categories = @("Ресторан")
        cuisines = @("Европейская")
        price_range = "`$`$"
        working_hours = @{
            monday = @{ open = "10:00"; close = "22:00" }
            tuesday = @{ open = "10:00"; close = "22:00" }
            wednesday = @{ open = "10:00"; close = "22:00" }
            thursday = @{ open = "10:00"; close = "22:00" }
            friday = @{ open = "10:00"; close = "23:00" }
            saturday = @{ open = "11:00"; close = "23:00" }
            sunday = @{ open = "11:00"; close = "22:00" }
        }
        attributes = @{
            wifi = $true
            parking = $true
        }
    } | ConvertTo-Json -Depth 10
    
    $headers = @{
        "Authorization" = "Bearer $script:AuthToken"
        "Content-Type" = "application/json"
    }
    
    $response = Invoke-RestMethod -Uri "$ApiBaseUrl/partner/establishments" -Method POST -Headers $headers -Body $establishmentData
    
    if ($response.success -and $response.data.id) {
        $script:EstablishmentId = $response.data.id
        Write-TestPass "Establishment created with ID: $script:EstablishmentId"
        
        if ($response.data.status -eq "draft") {
            Write-TestPass "Status correctly set to draft"
        }
    } else {
        Write-TestFail "Establishment creation failed"
    }
} catch {
    Write-TestFail "Create establishment error: $_"
}

# Test 4: List Establishments
Start-Test "List Partner Establishments"
try {
    $headers = @{
        "Authorization" = "Bearer $script:AuthToken"
    }
    
    $response = Invoke-RestMethod -Uri "$ApiBaseUrl/partner/establishments" -Method GET -Headers $headers
    
    if ($response.success) {
        $count = $response.data.Count
        Write-TestPass "Retrieved $count establishment(s)"
        
        if ($response.meta.total -ne $null) {
            Write-TestPass "Pagination metadata present"
        }
    } else {
        Write-TestFail "List establishments failed"
    }
} catch {
    Write-TestFail "List establishments error: $_"
}

# Test 5: Get Establishment Details
if ($script:EstablishmentId) {
    Start-Test "Get Establishment Details"
    try {
        $headers = @{
            "Authorization" = "Bearer $script:AuthToken"
        }
        
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/partner/establishments/$script:EstablishmentId" -Method GET -Headers $headers
        
        if ($response.success) {
            Write-TestPass "Retrieved establishment details"
            
            $requiredFields = @("name", "city", "address")
            $allPresent = $true
            
            foreach ($field in $requiredFields) {
                if ($null -eq $response.data.$field) {
                    Write-TestFail "Missing required field: $field"
                    $allPresent = $false
                }
            }
            
            if ($allPresent) {
                Write-TestPass "All required fields present"
            }
        } else {
            Write-TestFail "Get establishment details failed"
        }
    } catch {
        Write-TestFail "Get details error: $_"
    }
}

# Test 6: Update Establishment
if ($script:EstablishmentId) {
    Start-Test "Update Establishment"
    try {
        $updateData = @{
            description = "Updated by automated test"
        } | ConvertTo-Json
        
        $headers = @{
            "Authorization" = "Bearer $script:AuthToken"
            "Content-Type" = "application/json"
        }
        
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/partner/establishments/$script:EstablishmentId" -Method PUT -Headers $headers -Body $updateData
        
        if ($response.success) {
            Write-TestPass "Establishment updated successfully"
        } else {
            Write-TestFail "Update establishment failed"
        }
    } catch {
        Write-TestFail "Update establishment error: $_"
    }
}

# Test 7: Unauthorized Access
Start-Test "Test Unauthorized Access"
try {
    $response = Invoke-RestMethod -Uri "$ApiBaseUrl/partner/establishments" -Method GET -ErrorAction Stop
    Write-TestFail "Should have rejected unauthorized request"
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-TestPass "Correctly rejected unauthorized request"
    } else {
        Write-TestFail "Unexpected error for unauthorized request"
    }
}

# Summary
Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""
Write-Host "  Total Tests:  $script:TotalTests"
Write-Host "  Passed:       $script:PassedTests" -ForegroundColor Green
Write-Host "  Failed:       $script:FailedTests" -ForegroundColor Red
Write-Host ""

if ($script:FailedTests -eq 0) {
    Write-Host "=" * 60 -ForegroundColor Green
    Write-Host "  ALL TESTS PASSED" -ForegroundColor Green
    Write-Host "=" * 60 -ForegroundColor Green
    exit 0
} else {
    Write-Host "=" * 60 -ForegroundColor Red
    Write-Host "  SOME TESTS FAILED" -ForegroundColor Red
    Write-Host "=" * 60 -ForegroundColor Red
    exit 1
}

