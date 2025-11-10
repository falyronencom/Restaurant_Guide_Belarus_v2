# Establishments Management System - Automated API Test Script (PowerShell)
#
# Purpose: Systematically test all establishment and media endpoints
# Requirements: PowerShell 5.1+
# Usage: .\test_establishments_api.ps1
#
# This script performs comprehensive testing of the Establishments Management
# System by making actual HTTP requests to the API and validating responses.

[CmdletBinding()]
param(
    [string]$ApiBaseUrl = "http://localhost:3000/api/v1",
    [string]$PartnerEmail = "partner@test.com",
    [string]$PartnerPassword = "test123"
)

# Test state variables
$script:TotalTests = 0
$script:PassedTests = 0
$script:FailedTests = 0
$script:AuthToken = ""
$script:EstablishmentId = ""
$script:MediaId1 = ""
$script:MediaId2 = ""
$script:TestImagePath = "$env:TEMP\test_image.jpg"

################################################################################
# Utility Functions
################################################################################

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-TestSuccess {
    param([string]$Message)
    Write-Host "[✓ PASS] $Message" -ForegroundColor Green
    $script:PassedTests++
}

function Write-TestFailure {
    param([string]$Message)
    Write-Host "[✗ FAIL] $Message" -ForegroundColor Red
    $script:FailedTests++
}

function Write-TestWarning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host ""
}

function Start-TestCase {
    param([string]$Description)
    $script:TotalTests++
    Write-Info "Test $($script:TotalTests): $Description"
}

function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [hashtable]$Headers = @{},
        [string]$ContentType = "application/json",
        [string]$InFile = $null
    )
    
    $uri = "$ApiBaseUrl$Endpoint"
    $requestHeaders = $Headers.Clone()
    
    if ($script:AuthToken) {
        $requestHeaders["Authorization"] = "Bearer $script:AuthToken"
    }
    
    try {
        if ($InFile) {
            # File upload - multipart/form-data
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $requestHeaders -InFile $InFile -ContentType $ContentType
        }
        elseif ($Body) {
            $jsonBody = $Body | ConvertTo-Json -Depth 10 -Compress
            $requestHeaders["Content-Type"] = $ContentType
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $requestHeaders -Body $jsonBody
        }
        else {
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $requestHeaders
        }
        return $response
    }
    catch {
        $errorResponse = $_.ErrorDetails.Message
        if ($errorResponse) {
            try {
                return ($errorResponse | ConvertFrom-Json)
            }
            catch {
                return @{ success = $false; message = $errorResponse }
            }
        }
        return @{ success = $false; message = $_.Exception.Message }
    }
}

function Test-ResponseSuccess {
    param([object]$Response)
    return ($Response.success -eq $true)
}

################################################################################
# Setup Functions
################################################################################

function Test-ApiHealth {
    Write-Section "Testing API Health"
    Start-TestCase "API health check endpoint"
    
    try {
        $response = Invoke-ApiRequest -Method GET -Endpoint "/health"
        
        if (Test-ResponseSuccess $response) {
            Write-TestSuccess "API is healthy and responding"
            return $true
        }
        else {
            Write-TestFailure "API health check failed. Is the server running on $ApiBaseUrl?"
            return $false
        }
    }
    catch {
        Write-TestFailure "Cannot connect to API: $_"
        return $false
    }
}

function Get-PartnerAuthentication {
    Write-Section "Partner Authentication"
    Start-TestCase "Partner login to obtain JWT token"
    
    $loginData = @{
        email    = $PartnerEmail
        password = $PartnerPassword
    }
    
    try {
        $response = Invoke-ApiRequest -Method POST -Endpoint "/auth/login" -Body $loginData
        
        if (Test-ResponseSuccess $response) {
            $script:AuthToken = $response.data.access_token
            
            if ($script:AuthToken) {
                Write-TestSuccess "Authentication successful, token obtained"
                Write-Info "Token: $($script:AuthToken.Substring(0, [Math]::Min(20, $script:AuthToken.Length)))..."
                return $true
            }
            else {
                Write-TestFailure "Authentication succeeded but no token returned"
                return $false
            }
        }
        else {
            Write-TestFailure "Authentication failed: $($response.message)"
            Write-Info "Email: $PartnerEmail"
            Write-Info "Check if partner account exists with correct password"
            return $false
        }
    }
    catch {
        Write-TestFailure "Authentication error: $_"
        return $false
    }
}

function New-TestImage {
    Write-Section "Creating Test Image"
    
    # Create a minimal valid JPEG file (1x1 pixel)
    $jpegBase64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k="
    $jpegBytes = [System.Convert]::FromBase64String($jpegBase64)
    [System.IO.File]::WriteAllBytes($script:TestImagePath, $jpegBytes)
    
    if (Test-Path $script:TestImagePath) {
        Write-TestSuccess "Test image created at $script:TestImagePath"
        return $true
    }
    else {
        Write-TestFailure "Failed to create test image"
        return $false
    }
}

################################################################################
# Establishment CRUD Tests
################################################################################

function Test-CreateEstablishment {
    Write-Section "Testing Establishment Creation"
    Start-TestCase "Create new establishment with minimal required fields"
    
    $establishmentData = @{
        name          = "Automated Test Restaurant"
        description   = "This is a test establishment created by automated script"
        city          = "Минск"
        address       = "пр. Независимости 1"
        latitude      = 53.9045
        longitude     = 27.5615
        phone         = "+375291234567"
        email         = "test@restaurant.by"
        categories    = @("Ресторан")
        cuisines      = @("Европейская")
        price_range   = "`$`$"
        working_hours = @{
            monday    = @{ open = "10:00"; close = "22:00" }
            tuesday   = @{ open = "10:00"; close = "22:00" }
            wednesday = @{ open = "10:00"; close = "22:00" }
            thursday  = @{ open = "10:00"; close = "22:00" }
            friday    = @{ open = "10:00"; close = "23:00" }
            saturday  = @{ open = "11:00"; close = "23:00" }
            sunday    = @{ open = "11:00"; close = "22:00" }
        }
        attributes    = @{
            wifi    = $true
            parking = $true
            terrace = $false
        }
    }
    
    $response = Invoke-ApiRequest -Method POST -Endpoint "/partner/establishments" -Body $establishmentData
    
    if (Test-ResponseSuccess $response) {
        $script:EstablishmentId = $response.data.id
        $status = $response.data.status
        
        if ($script:EstablishmentId) {
            Write-TestSuccess "Establishment created with ID: $script:EstablishmentId"
            
            if ($status -eq "draft") {
                Write-TestSuccess "Status correctly set to draft"
            }
            else {
                Write-TestFailure "Status should be draft but is: $status"
            }
        }
        else {
            Write-TestFailure "Establishment created but no ID returned"
        }
    }
    else {
        Write-TestFailure "Failed to create establishment: $($response.message)"
    }
}

function Test-ListEstablishments {
    Write-Section "Testing Establishment Listing"
    Start-TestCase "Get partner establishment list"
    
    $response = Invoke-ApiRequest -Method GET -Endpoint "/partner/establishments"
    
    if (Test-ResponseSuccess $response) {
        $count = $response.data.Count
        Write-TestSuccess "Retrieved $count establishment(s)"
        
        if ($response.meta.total -ne $null) {
            Write-TestSuccess "Pagination metadata present"
        }
        else {
            Write-TestFailure "Pagination metadata missing"
        }
    }
    else {
        Write-TestFailure "Failed to retrieve establishment list"
    }
}

function Test-GetEstablishmentDetails {
    Write-Section "Testing Get Establishment Details"
    
    if (-not $script:EstablishmentId) {
        Write-TestWarning "Skipping test - no establishment ID available"
        return
    }
    
    Start-TestCase "Get single establishment by ID"
    
    $response = Invoke-ApiRequest -Method GET -Endpoint "/partner/establishments/$script:EstablishmentId"
    
    if (Test-ResponseSuccess $response) {
        $name = $response.data.name
        Write-TestSuccess "Retrieved establishment: $name"
        
        $requiredFields = @("name", "city", "address", "categories", "cuisines", "working_hours")
        $allPresent = $true
        
        foreach ($field in $requiredFields) {
            if ($null -eq $response.data.$field) {
                Write-TestFailure "Required field $field is missing"
                $allPresent = $false
            }
        }
        
        if ($allPresent) {
            Write-TestSuccess "All required fields present"
        }
    }
    else {
        Write-TestFailure "Failed to retrieve establishment details"
    }
}

function Test-UpdateEstablishment {
    Write-Section "Testing Establishment Update"
    
    if (-not $script:EstablishmentId) {
        Write-TestWarning "Skipping test - no establishment ID available"
        return
    }
    
    Start-TestCase "Update establishment description (minor change)"
    
    $updateData = @{
        description = "Updated description by automated test"
        phone       = "+375291234568"
    }
    
    $response = Invoke-ApiRequest -Method PUT -Endpoint "/partner/establishments/$script:EstablishmentId" -Body $updateData
    
    if (Test-ResponseSuccess $response) {
        Write-TestSuccess "Establishment updated successfully"
        
        $status = $response.data.status
        if ($status -eq "draft") {
            Write-TestSuccess "Status correctly remained draft after minor update"
        }
        else {
            Write-TestWarning "Status changed to: $status after minor update"
        }
    }
    else {
        Write-TestFailure "Failed to update establishment"
    }
}

################################################################################
# Media Management Tests
################################################################################

function Test-UploadInteriorPhoto {
    Write-Section "Testing Media Upload - Interior"
    
    if (-not $script:EstablishmentId) {
        Write-TestWarning "Skipping test - no establishment ID available"
        return
    }
    
    Start-TestCase "Upload interior photo with is_primary=true"
    
    # PowerShell multipart form upload
    $boundary = [System.Guid]::NewGuid().ToString()
    $LF = "`r`n"
    
    $fileContent = [System.IO.File]::ReadAllBytes($script:TestImagePath)
    $fileContentEncoded = [System.Text.Encoding]::GetEncoding("ISO-8859-1").GetString($fileContent)
    
    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"test_image.jpg`"",
        "Content-Type: image/jpeg$LF",
        $fileContentEncoded,
        "--$boundary",
        "Content-Disposition: form-data; name=`"type`"$LF",
        "interior",
        "--$boundary",
        "Content-Disposition: form-data; name=`"caption`"$LF",
        "Test interior photo",
        "--$boundary",
        "Content-Disposition: form-data; name=`"is_primary`"$LF",
        "true",
        "--$boundary--$LF"
    )
    
    $body = $bodyLines -join $LF
    
    try {
        $uri = "$ApiBaseUrl/partner/establishments/$script:EstablishmentId/media"
        $headers = @{
            "Authorization" = "Bearer $script:AuthToken"
        }
        
        $response = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body -ContentType "multipart/form-data; boundary=$boundary"
        
        if (Test-ResponseSuccess $response) {
            $script:MediaId1 = $response.data.id
            Write-TestSuccess "Interior photo uploaded with ID: $script:MediaId1"
            
            if ($response.data.url -and $response.data.preview_url -and $response.data.thumbnail_url) {
                Write-TestSuccess "All three resolution URLs generated"
                
                if ($response.data.url -match "f_auto" -and $response.data.url -match "q_auto") {
                    Write-TestSuccess "URLs contain required optimization parameters"
                }
                else {
                    Write-TestFailure "URLs missing optimization parameters"
                }
            }
            else {
                Write-TestFailure "Missing one or more resolution URLs"
            }
            
            if ($response.data.is_primary -eq $true) {
                Write-TestSuccess "is_primary flag correctly set to true"
            }
            else {
                Write-TestFailure "is_primary flag should be true"
            }
        }
        else {
            Write-TestFailure "Failed to upload interior photo: $($response.message)"
        }
    }
    catch {
        Write-TestFailure "Failed to upload interior photo: $_"
    }
}

function Test-GetMediaList {
    Write-Section "Testing Get Media List"
    
    if (-not $script:EstablishmentId) {
        Write-TestWarning "Skipping test - no establishment ID available"
        return
    }
    
    Start-TestCase "Get all media for establishment"
    
    $response = Invoke-ApiRequest -Method GET -Endpoint "/partner/establishments/$script:EstablishmentId/media"
    
    if (Test-ResponseSuccess $response) {
        $count = $response.data.Count
        Write-TestSuccess "Retrieved $count media item(s)"
    }
    else {
        Write-TestFailure "Failed to retrieve media list"
    }
}

################################################################################
# Submission Workflow Tests
################################################################################

function Test-SubmitForModeration {
    Write-Section "Testing Submission for Moderation"
    
    if (-not $script:EstablishmentId) {
        Write-TestWarning "Skipping test - no establishment ID available"
        return
    }
    
    Start-TestCase "Submit establishment for moderation"
    
    $response = Invoke-ApiRequest -Method POST -Endpoint "/partner/establishments/$script:EstablishmentId/submit"
    
    if (Test-ResponseSuccess $response) {
        $status = $response.data.status
        
        if ($status -eq "pending") {
            Write-TestSuccess "Establishment submitted, status changed to pending"
        }
        else {
            Write-TestFailure "Status should be pending but is: $status"
        }
    }
    else {
        if ($response.error_code -eq "INCOMPLETE_ESTABLISHMENT") {
            Write-TestWarning "Submission failed due to incomplete information (expected if media not uploaded)"
        }
        else {
            Write-TestFailure "Submission failed: $($response.message)"
        }
    }
}

################################################################################
# Error Handling Tests
################################################################################

function Test-UnauthorizedAccess {
    Write-Section "Testing Authorization and Error Handling"
    Start-TestCase "Attempt to access without authentication token"
    
    $savedToken = $script:AuthToken
    $script:AuthToken = ""
    
    $response = Invoke-ApiRequest -Method GET -Endpoint "/partner/establishments"
    
    $script:AuthToken = $savedToken
    
    if (-not (Test-ResponseSuccess $response)) {
        Write-TestSuccess "Correctly rejected unauthenticated request"
    }
    else {
        Write-TestFailure "Should have rejected unauthenticated request"
    }
}

function Test-InvalidEstablishmentId {
    Write-Section "Testing Invalid ID Handling"
    Start-TestCase "Attempt to access non-existent establishment"
    
    $fakeId = "00000000-0000-0000-0000-000000000000"
    $response = Invoke-ApiRequest -Method GET -Endpoint "/partner/establishments/$fakeId"
    
    if (-not (Test-ResponseSuccess $response)) {
        Write-TestSuccess "Correctly returned error for invalid establishment ID"
    }
    else {
        Write-TestFailure "Should have returned error for invalid ID"
    }
}

################################################################################
# Cleanup
################################################################################

function Invoke-Cleanup {
    Write-Section "Cleanup"
    
    if (Test-Path $script:TestImagePath) {
        Remove-Item $script:TestImagePath -Force
        Write-Info "Test image removed"
    }
}

################################################################################
# Main Execution
################################################################################

function Main {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host "  Establishments Management System - Automated API Tests" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host ""
    Write-Info "API Base URL: $ApiBaseUrl"
    Write-Info "Partner Email: $PartnerEmail"
    Write-Host ""
    
    # Prerequisites and setup
    if (-not (Test-ApiHealth)) {
        Write-Host ""
        Write-Host "API is not reachable. Please ensure:" -ForegroundColor Red
        Write-Host "  1. Backend server is running (npm run dev)" -ForegroundColor Yellow
        Write-Host "  2. Server is listening on $ApiBaseUrl" -ForegroundColor Yellow
        Write-Host "  3. Database and Redis are connected" -ForegroundColor Yellow
        exit 1
    }
    
    if (-not (Get-PartnerAuthentication)) {
        Write-Host ""
        Write-Host "Authentication failed. Please ensure:" -ForegroundColor Red
        Write-Host "  1. Partner account exists in database" -ForegroundColor Yellow
        Write-Host "  2. Credentials are correct: $PartnerEmail / $PartnerPassword" -ForegroundColor Yellow
        exit 1
    }
    
    if (-not (New-TestImage)) {
        exit 1
    }
    
    # Core establishment CRUD tests
    Test-CreateEstablishment
    Test-ListEstablishments
    Test-GetEstablishmentDetails
    Test-UpdateEstablishment
    
    # Media management tests
    Test-UploadInteriorPhoto
    Test-GetMediaList
    
    # Submission workflow
    Test-SubmitForModeration
    
    # Error handling tests
    Test-UnauthorizedAccess
    Test-InvalidEstablishmentId
    
    # Cleanup
    Invoke-Cleanup
    
    # Print summary
    Write-Section "Test Summary"
    Write-Host ""
    Write-Host "  Total Tests:  $script:TotalTests"
    Write-Host "  Passed:       $script:PassedTests" -ForegroundColor Green
    Write-Host "  Failed:       $script:FailedTests" -ForegroundColor Red
    Write-Host ""
    
    if ($script:FailedTests -eq 0) {
        Write-Host ("=" * 60) -ForegroundColor Green
        Write-Host "  ✓ ALL TESTS PASSED" -ForegroundColor Green
        Write-Host ("=" * 60) -ForegroundColor Green
        exit 0
    }
    else {
        Write-Host ("=" * 60) -ForegroundColor Red
        Write-Host "  ✗ SOME TESTS FAILED" -ForegroundColor Red
        Write-Host ("=" * 60) -ForegroundColor Red
        exit 1
    }
}

# Run the tests
Main

