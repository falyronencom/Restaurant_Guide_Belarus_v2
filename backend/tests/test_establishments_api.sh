#!/bin/bash

################################################################################
# Establishments Management System - Automated API Test Script
#
# Purpose: Systematically test all establishment and media endpoints
# Requirements: curl, jq (for JSON parsing)
# Usage: ./test_establishments_api.sh
#
# This script performs comprehensive testing of the Establishments Management
# System by making actual HTTP requests to the API and validating responses.
# It's more thorough than smoke tests and covers both happy paths and error
# scenarios.
#
# The script uses color-coded output to make results easy to scan:
# - Green: Test passed successfully
# - Red: Test failed
# - Yellow: Warning or setup issue
# - Blue: Informational messages
################################################################################

# Script configuration
set -e  # Exit on error (will be temporarily disabled for expected failures)
set -u  # Exit on undefined variable

# Color codes for output formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API configuration - adjust these for your environment
API_BASE_URL="${API_BASE_URL:-http://localhost:3000/api/v1}"
PARTNER_EMAIL="${PARTNER_EMAIL:-test-partner@example.com}"
PARTNER_PASSWORD="${PARTNER_PASSWORD:-TestPass123}"

# Test state variables
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
AUTH_TOKEN=""
ESTABLISHMENT_ID=""
MEDIA_ID_1=""
MEDIA_ID_2=""

# Test image file for uploads (will be created)
TEST_IMAGE_PATH="/tmp/test_image.jpg"

################################################################################
# Utility Functions
################################################################################

# Print colored output for different message types
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓ PASS]${NC} $1"
    ((PASSED_TESTS++))
}

print_failure() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    ((FAILED_TESTS++))
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Print section headers for better organization
print_section() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
}

# Increment test counter
start_test() {
    ((TOTAL_TESTS++))
    print_info "Test $TOTAL_TESTS: $1"
}

# Make HTTP request and capture response
# Usage: make_request METHOD URL [DATA] [CONTENT_TYPE]
make_request() {
    local method=$1
    local url=$2
    local data=${3:-}
    local content_type=${4:-application/json}
    
    if [ -n "$data" ]; then
        if [ "$content_type" = "multipart/form-data" ]; then
            # For file uploads, data is the form parameters
            curl -s -X "$method" \
                -H "Authorization: Bearer $AUTH_TOKEN" \
                $data \
                "$API_BASE_URL$url"
        else
            # For JSON requests
            curl -s -X "$method" \
                -H "Content-Type: $content_type" \
                -H "Authorization: Bearer $AUTH_TOKEN" \
                -d "$data" \
                "$API_BASE_URL$url"
        fi
    else
        # GET requests without body
        curl -s -X "$method" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            "$API_BASE_URL$url"
    fi
}

# Check if response indicates success
check_response_success() {
    local response=$1
    local expected_status=${2:-200}
    
    # Extract success field from JSON response
    local success=$(echo "$response" | jq -r '.success // false')
    
    if [ "$success" = "true" ]; then
        return 0
    else
        return 1
    fi
}

# Extract field from JSON response
extract_field() {
    local response=$1
    local field=$2
    echo "$response" | jq -r "$field"
}

################################################################################
# Setup Functions
################################################################################

# Check prerequisites
check_prerequisites() {
    print_section "Checking Prerequisites"
    
    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        print_failure "curl is not installed. Please install curl to run this script."
        exit 1
    fi
    
    # Check if jq is installed (for JSON parsing)
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. JSON parsing will be limited."
        print_info "Install jq for better test output: sudo apt-get install jq"
    fi
    
    print_success "All prerequisites satisfied"
}

# Test API health
test_api_health() {
    print_section "Testing API Health"
    start_test "API health check endpoint"
    
    response=$(curl -s "$API_BASE_URL/health")
    
    if check_response_success "$response"; then
        print_success "API is healthy and responding"
    else
        print_failure "API health check failed. Is the server running?"
        exit 1
    fi
}

# Authenticate and get JWT token
authenticate_partner() {
    print_section "Partner Authentication"
    start_test "Partner login to obtain JWT token"
    
    # Attempt login
    response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$PARTNER_EMAIL\",\"password\":\"$PARTNER_PASSWORD\"}" \
        "$API_BASE_URL/auth/login")
    
    if check_response_success "$response"; then
        AUTH_TOKEN=$(extract_field "$response" ".data.token")
        
        if [ -n "$AUTH_TOKEN" ] && [ "$AUTH_TOKEN" != "null" ]; then
            print_success "Authentication successful, token obtained"
            print_info "Token: ${AUTH_TOKEN:0:20}..." # Show first 20 chars only
        else
            print_failure "Authentication succeeded but no token returned"
            exit 1
        fi
    else
        print_failure "Authentication failed. Check credentials or create test partner account."
        print_info "Email: $PARTNER_EMAIL"
        print_info "Expected password: $PARTNER_PASSWORD"
        exit 1
    fi
}

# Create test image file for upload testing
create_test_image() {
    print_section "Creating Test Image"
    
    # Create a simple 1x1 pixel JPEG for testing
    # This uses base64 encoded minimal JPEG data
    echo "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=" | base64 -d > "$TEST_IMAGE_PATH"
    
    if [ -f "$TEST_IMAGE_PATH" ]; then
        print_success "Test image created at $TEST_IMAGE_PATH"
    else
        print_failure "Failed to create test image"
        exit 1
    fi
}

################################################################################
# Establishment CRUD Tests
################################################################################

test_create_establishment() {
    print_section "Testing Establishment Creation"
    
    start_test "Create new establishment with minimal required fields"
    
    local establishment_data='{
        "name": "Automated Test Restaurant",
        "description": "This is a test establishment created by automated script",
        "city": "Минск",
        "address": "пр. Независимости 1",
        "latitude": 53.9045,
        "longitude": 27.5615,
        "phone": "+375291234567",
        "email": "test@restaurant.by",
        "categories": ["Ресторан"],
        "cuisines": ["Европейская"],
        "price_range": "$$",
        "working_hours": {
            "monday": {"open": "10:00", "close": "22:00"},
            "tuesday": {"open": "10:00", "close": "22:00"},
            "wednesday": {"open": "10:00", "close": "22:00"},
            "thursday": {"open": "10:00", "close": "22:00"},
            "friday": {"open": "10:00", "close": "23:00"},
            "saturday": {"open": "11:00", "close": "23:00"},
            "sunday": {"open": "11:00", "close": "22:00"}
        },
        "attributes": {
            "wifi": true,
            "parking": true,
            "terrace": false
        }
    }'
    
    response=$(make_request POST "/partner/establishments" "$establishment_data")
    
    if check_response_success "$response"; then
        ESTABLISHMENT_ID=$(extract_field "$response" ".data.id")
        local status=$(extract_field "$response" ".data.status")
        
        if [ -n "$ESTABLISHMENT_ID" ] && [ "$ESTABLISHMENT_ID" != "null" ]; then
            print_success "Establishment created with ID: $ESTABLISHMENT_ID"
            
            if [ "$status" = "draft" ]; then
                print_success "Status correctly set to 'draft'"
            else
                print_failure "Status should be 'draft' but is '$status'"
            fi
        else
            print_failure "Establishment created but no ID returned"
        fi
    else
        print_failure "Failed to create establishment"
        local error_msg=$(extract_field "$response" ".message")
        print_info "Error: $error_msg"
    fi
}

test_list_establishments() {
    print_section "Testing Establishment Listing"
    
    start_test "Get partner's establishment list"
    
    response=$(make_request GET "/partner/establishments")
    
    if check_response_success "$response"; then
        local count=$(extract_field "$response" ".data | length")
        print_success "Retrieved $count establishment(s)"
        
        # Verify pagination metadata exists
        local total=$(extract_field "$response" ".meta.total")
        if [ "$total" != "null" ]; then
            print_success "Pagination metadata present"
        else
            print_failure "Pagination metadata missing"
        fi
    else
        print_failure "Failed to retrieve establishment list"
    fi
}

test_get_establishment_details() {
    print_section "Testing Get Establishment Details"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Get single establishment by ID"
    
    response=$(make_request GET "/partner/establishments/$ESTABLISHMENT_ID")
    
    if check_response_success "$response"; then
        local name=$(extract_field "$response" ".data.name")
        print_success "Retrieved establishment: $name"
        
        # Verify all fields are present
        local fields=("name" "city" "address" "categories" "cuisines" "working_hours")
        local all_present=true
        
        for field in "${fields[@]}"; do
            local value=$(extract_field "$response" ".data.$field")
            if [ "$value" = "null" ]; then
                print_failure "Required field '$field' is missing"
                all_present=false
            fi
        done
        
        if [ "$all_present" = true ]; then
            print_success "All required fields present"
        fi
    else
        print_failure "Failed to retrieve establishment details"
    fi
}

test_update_establishment() {
    print_section "Testing Establishment Update"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Update establishment description (minor change)"
    
    local update_data='{
        "description": "Updated description by automated test",
        "phone": "+375291234568"
    }'
    
    response=$(make_request PUT "/partner/establishments/$ESTABLISHMENT_ID" "$update_data")
    
    if check_response_success "$response"; then
        print_success "Establishment updated successfully"
        
        # Verify status remained 'draft' (minor change doesn't trigger reset)
        local status=$(extract_field "$response" ".data.status")
        if [ "$status" = "draft" ]; then
            print_success "Status correctly remained 'draft' after minor update"
        else
            print_warning "Status changed to '$status' after minor update"
        fi
    else
        print_failure "Failed to update establishment"
    fi
}

################################################################################
# Media Management Tests
################################################################################

test_upload_interior_photo() {
    print_section "Testing Media Upload - Interior"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Upload interior photo with is_primary=true"
    
    # Prepare multipart form data
    local form_data="-F file=@$TEST_IMAGE_PATH -F type=interior -F caption=Test interior photo -F is_primary=true"
    
    response=$(make_request POST "/partner/establishments/$ESTABLISHMENT_ID/media" "$form_data" "multipart/form-data")
    
    if check_response_success "$response"; then
        MEDIA_ID_1=$(extract_field "$response" ".data.id")
        local url=$(extract_field "$response" ".data.url")
        local preview_url=$(extract_field "$response" ".data.preview_url")
        local thumbnail_url=$(extract_field "$response" ".data.thumbnail_url")
        
        print_success "Interior photo uploaded with ID: $MEDIA_ID_1"
        
        # Verify three URLs are present
        if [ -n "$url" ] && [ -n "$preview_url" ] && [ -n "$thumbnail_url" ]; then
            print_success "All three resolution URLs generated"
            
            # Check if URLs contain optimization parameters
            if echo "$url" | grep -q "f_auto" && echo "$url" | grep -q "q_auto"; then
                print_success "URLs contain required optimization parameters"
            else
                print_failure "URLs missing optimization parameters (f_auto, q_auto)"
            fi
        else
            print_failure "Missing one or more resolution URLs"
        fi
        
        # Verify is_primary flag
        local is_primary=$(extract_field "$response" ".data.is_primary")
        if [ "$is_primary" = "true" ]; then
            print_success "is_primary flag correctly set to true"
        else
            print_failure "is_primary flag should be true but is '$is_primary'"
        fi
    else
        print_failure "Failed to upload interior photo"
        local error_msg=$(extract_field "$response" ".message")
        print_info "Error: $error_msg"
    fi
}

test_upload_menu_photo() {
    print_section "Testing Media Upload - Menu"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Upload menu photo with is_primary=false"
    
    local form_data="-F file=@$TEST_IMAGE_PATH -F type=menu -F caption=Test menu photo -F is_primary=false"
    
    response=$(make_request POST "/partner/establishments/$ESTABLISHMENT_ID/media" "$form_data" "multipart/form-data")
    
    if check_response_success "$response"; then
        MEDIA_ID_2=$(extract_field "$response" ".data.id")
        print_success "Menu photo uploaded with ID: $MEDIA_ID_2"
        
        # Verify is_primary is false
        local is_primary=$(extract_field "$response" ".data.is_primary")
        if [ "$is_primary" = "false" ]; then
            print_success "is_primary flag correctly set to false"
        else
            print_failure "is_primary flag should be false but is '$is_primary'"
        fi
    else
        print_failure "Failed to upload menu photo"
    fi
}

test_get_media_list() {
    print_section "Testing Get Media List"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Get all media for establishment"
    
    response=$(make_request GET "/partner/establishments/$ESTABLISHMENT_ID/media")
    
    if check_response_success "$response"; then
        local count=$(extract_field "$response" ".data | length")
        print_success "Retrieved $count media item(s)"
        
        if [ "$count" -ge 2 ]; then
            print_success "Both uploaded photos present in list"
        else
            print_warning "Expected at least 2 media items but found $count"
        fi
    else
        print_failure "Failed to retrieve media list"
    fi
}

test_update_media() {
    print_section "Testing Media Update"
    
    if [ -z "$MEDIA_ID_2" ]; then
        print_warning "Skipping test - no media ID available"
        return
    fi
    
    start_test "Update media caption and position"
    
    local update_data='{
        "caption": "Updated caption by automated test",
        "position": 5
    }'
    
    response=$(make_request PUT "/partner/establishments/$ESTABLISHMENT_ID/media/$MEDIA_ID_2" "$update_data")
    
    if check_response_success "$response"; then
        local new_caption=$(extract_field "$response" ".data.caption")
        local new_position=$(extract_field "$response" ".data.position")
        
        print_success "Media updated successfully"
        print_info "New caption: $new_caption"
        print_info "New position: $new_position"
    else
        print_failure "Failed to update media"
    fi
}

test_change_primary_photo() {
    print_section "Testing Primary Photo Change"
    
    if [ -z "$MEDIA_ID_2" ]; then
        print_warning "Skipping test - no media ID available"
        return
    fi
    
    start_test "Change primary photo to second media"
    
    local update_data='{"is_primary": true}'
    
    response=$(make_request PUT "/partner/establishments/$ESTABLISHMENT_ID/media/$MEDIA_ID_2" "$update_data")
    
    if check_response_success "$response"; then
        print_success "Primary photo changed successfully"
        
        # Verify by getting media list
        sleep 1  # Brief delay to ensure consistency
        list_response=$(make_request GET "/partner/establishments/$ESTABLISHMENT_ID/media")
        
        # Count how many photos have is_primary=true
        local primary_count=$(extract_field "$list_response" '[.data[] | select(.is_primary == true)] | length')
        
        if [ "$primary_count" = "1" ]; then
            print_success "Only one photo is marked as primary"
        else
            print_failure "Found $primary_count primary photos (should be exactly 1)"
        fi
    else
        print_failure "Failed to change primary photo"
    fi
}

test_delete_media() {
    print_section "Testing Media Deletion"
    
    if [ -z "$MEDIA_ID_1" ]; then
        print_warning "Skipping test - no media ID available"
        return
    fi
    
    start_test "Delete media (non-primary photo)"
    
    response=$(make_request DELETE "/partner/establishments/$ESTABLISHMENT_ID/media/$MEDIA_ID_1")
    
    if check_response_success "$response"; then
        print_success "Media deleted successfully"
        
        # Verify deletion by trying to fetch deleted media
        sleep 1
        list_response=$(make_request GET "/partner/establishments/$ESTABLISHMENT_ID/media")
        local remaining_count=$(extract_field "$list_response" ".data | length")
        
        print_info "Remaining media count: $remaining_count"
    else
        print_failure "Failed to delete media"
    fi
}

################################################################################
# Submission Workflow Tests
################################################################################

test_submit_for_moderation() {
    print_section "Testing Submission for Moderation"
    
    if [ -z "$ESTABLISHMENT_ID" ]; then
        print_warning "Skipping test - no establishment ID available"
        return
    fi
    
    start_test "Submit establishment for moderation"
    
    response=$(make_request POST "/partner/establishments/$ESTABLISHMENT_ID/submit")
    
    if check_response_success "$response"; then
        local status=$(extract_field "$response" ".data.status")
        
        if [ "$status" = "pending" ]; then
            print_success "Establishment submitted, status changed to 'pending'"
        else
            print_failure "Status should be 'pending' but is '$status'"
        fi
    else
        local error_code=$(extract_field "$response" ".error_code")
        
        # Submission might fail due to missing media requirements (which is expected)
        if [ "$error_code" = "INCOMPLETE_ESTABLISHMENT" ]; then
            print_warning "Submission failed due to incomplete information (expected behavior)"
            print_info "This is correct if media requirements are not met"
        else
            print_failure "Submission failed with unexpected error"
            local error_msg=$(extract_field "$response" ".message")
            print_info "Error: $error_msg"
        fi
    fi
}

################################################################################
# Error Handling Tests
################################################################################

test_unauthorized_access() {
    print_section "Testing Authorization and Error Handling"
    
    start_test "Attempt to access without authentication token"
    
    # Temporarily remove auth token
    local saved_token="$AUTH_TOKEN"
    AUTH_TOKEN=""
    
    response=$(make_request GET "/partner/establishments")
    
    # Restore token
    AUTH_TOKEN="$saved_token"
    
    # Should receive 401 Unauthorized
    local success=$(extract_field "$response" ".success")
    if [ "$success" = "false" ]; then
        print_success "Correctly rejected unauthenticated request"
    else
        print_failure "Should have rejected unauthenticated request"
    fi
}

test_invalid_establishment_id() {
    print_section "Testing Invalid ID Handling"
    
    start_test "Attempt to access non-existent establishment"
    
    local fake_id="00000000-0000-0000-0000-000000000000"
    response=$(make_request GET "/partner/establishments/$fake_id")
    
    local success=$(extract_field "$response" ".success")
    if [ "$success" = "false" ]; then
        print_success "Correctly returned error for invalid establishment ID"
    else
        print_failure "Should have returned error for invalid ID"
    fi
}

################################################################################
# Cleanup
################################################################################

cleanup() {
    print_section "Cleanup"
    
    # Note: In a real scenario, you might want to delete test data
    # For now, we'll just remove the test image
    if [ -f "$TEST_IMAGE_PATH" ]; then
        rm "$TEST_IMAGE_PATH"
        print_info "Test image removed"
    fi
    
    # Could add: Delete test establishment
    # This would require implementing delete endpoint or using admin privileges
}

################################################################################
# Main Execution
################################################################################

main() {
    echo ""
    echo "========================================================================"
    echo "  Establishments Management System - Automated API Tests"
    echo "========================================================================"
    echo ""
    print_info "API Base URL: $API_BASE_URL"
    print_info "Partner Email: $PARTNER_EMAIL"
    echo ""
    
    # Prerequisites and setup
    check_prerequisites
    test_api_health
    authenticate_partner
    create_test_image
    
    # Core establishment CRUD tests
    test_create_establishment
    test_list_establishments
    test_get_establishment_details
    test_update_establishment
    
    # Media management tests
    test_upload_interior_photo
    test_upload_menu_photo
    test_get_media_list
    test_update_media
    test_change_primary_photo
    test_delete_media
    
    # Submission workflow
    test_submit_for_moderation
    
    # Error handling tests
    test_unauthorized_access
    test_invalid_establishment_id
    
    # Cleanup
    cleanup
    
    # Print summary
    print_section "Test Summary"
    echo ""
    echo "  Total Tests:  $TOTAL_TESTS"
    echo -e "  ${GREEN}Passed:${NC}       $PASSED_TESTS"
    echo -e "  ${RED}Failed:${NC}       $FAILED_TESTS"
    echo ""
    
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  ✓ ALL TESTS PASSED${NC}"
        echo -e "${GREEN}========================================${NC}"
        exit 0
    else
        echo -e "${RED}========================================${NC}"
        echo -e "${RED}  ✗ SOME TESTS FAILED${NC}"
        echo -e "${RED}========================================${NC}"
        exit 1
    fi
}

# Run main function
main

