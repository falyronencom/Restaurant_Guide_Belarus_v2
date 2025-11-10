# Database Migration Guide: PostGIS Schema Alignment

**Project:** Restaurant Guide Belarus v2.0  
**Migration Version:** 002-006  
**Target:** Align establishments table schema with Search and Discovery System requirements  
**Estimated Duration:** 10-20 minutes  
**Complexity:** High (requires PostGIS setup and data transformation)

---

## Table of Contents

1. [Overview](#overview)
2. [What's Changing and Why](#whats-changing-and-why)
3. [Prerequisites](#prerequisites)
4. [Switching to PostGIS Docker Image](#switching-to-postgis-docker-image)
5. [Pre-Migration Checklist](#pre-migration-checklist)
6. [Migration Execution](#migration-execution)
7. [Post-Migration Verification](#post-migration-verification)
8. [Rollback Procedures](#rollback-procedures)
9. [Troubleshooting](#troubleshooting)
10. [Post-Migration Tasks](#post-migration-tasks)

---

## Overview

This migration transforms the establishments table schema from simple latitude/longitude numeric columns to PostGIS geography types with comprehensive geospatial functionality. This change is **critical** for the Search and Discovery System - our core MVP feature that enables users to find restaurants near their location throughout Belarus.

### What Problem Does This Solve?

The current schema uses `DECIMAL` columns for coordinates, which store location data but don't enable accurate distance calculations or efficient spatial queries. Without PostGIS:

- **Accuracy suffers**: Simple math on lat/long produces errors of 50-100 meters at Minsk's latitude
- **Performance is poor**: Every search requires calculating distance to every establishment
- **Scalability is limited**: Cannot handle thousands of establishments with acceptable response times

With PostGIS geography types and spatial indexes:

- **Accuracy**: Spheroidal calculations precise to centimeters
- **Performance**: Sub-100ms searches even with 10,000+ establishments
- **Future-ready**: Enables advanced features like delivery zones, route-based search, geofencing

### Migration Scope

**5 migration scripts** executing in sequence:
1. **002_enable_postgis.sql** - Enable PostGIS extension
2. **003_add_geography_column.sql** - Add location geography column
3. **004_rename_category_columns.sql** - Rename and transform category columns
4. **005_add_new_columns.sql** - Add new required fields
5. **006_create_indexes.sql** - Create performance indexes

**Estimated time:** 10-20 minutes total (mostly waiting for index creation)

---

## What's Changing and Why

### Database Schema Changes

| Current Schema | New Schema | Reason |
|---------------|------------|--------|
| `latitude DECIMAL(10,8)` | Preserved for compatibility | Keep original data during migration |
| `longitude DECIMAL(11,8)` | Preserved for compatibility | Keep original data during migration |
| *(no location column)* | `location GEOGRAPHY(Point, 4326)` | **NEW**: PostGIS geography for accurate geospatial queries |
| `categories VARCHAR(50)[]` | `category VARCHAR(100)` | Simplified to single primary category |
| `cuisines VARCHAR(50)[]` | `cuisine_type TEXT[]` | Renamed for consistency |
| `working_hours JSONB` | `operating_hours JSONB` | Renamed for clarity |
| `attributes JSONB` | `features TEXT[]` | Simplified to array of feature strings |
| *(no average_check column)* | `average_check_byn DECIMAL(10,2)` | **NEW**: Meal cost in Belarusian rubles |
| *(no is_24_hours column)* | `is_24_hours BOOLEAN` | **NEW**: Fast filtering for 24-hour establishments |
| *(no primary_image column)* | `primary_image_url TEXT` | **NEW**: Denormalized image URL for performance |

### Index Changes

**New spatial index (CRITICAL):**
- `idx_establishments_location` - GIST spatial index on location column
  - Enables efficient `ST_DWithin()` radius queries
  - Reduces search time from O(n) to O(log n)
  - Mandatory for acceptable search performance

**New B-tree indexes for filtering:**
- `idx_establishments_category` - Fast category filtering
- `idx_establishments_price_range` - Price-based filtering
- `idx_establishments_subscription_tier` - Ranking calculations
- `idx_establishments_rating` - Sort by rating

**New GIN indexes for array operations:**
- `idx_establishments_cuisine_type` - Cuisine containment queries
- `idx_establishments_features` - Feature containment queries

### Data Transformations

**Lossy transformations** (cannot be fully reversed):

1. **Categories array → single category**: If an establishment has multiple categories like `['restaurant', 'cafe']`, only the first will be kept as primary category. This is by design - each establishment has one primary type.

2. **Attributes JSONB → features array**: Complex nested JSONB structures are simplified to flat string arrays. Only top-level keys are extracted as features.

**Non-lossy transformations** (fully reversible):

1. **Lat/long → geography**: Geography points are calculated from existing coordinates. Original columns preserved.

2. **Column renames**: Simple renames with no data loss.

---

## Prerequisites

### System Requirements

- **PostgreSQL 15+** with PostGIS support
- **Node.js 18+** for running seed scripts
- **psql** command-line tool for executing migrations
- **Git** for version control

### Knowledge Requirements

- Basic SQL and PostgreSQL familiarity
- Understanding of command line operations
- Ability to modify docker-compose.yml files

### Access Requirements

- Database superuser or user with `CREATE EXTENSION` privilege
- Write access to backend/migrations directory
- Ability to restart Docker containers

---

## Switching to PostGIS Docker Image

**IMPORTANT:** The current PostgreSQL Docker image does NOT include PostGIS. You must switch to a PostGIS-enabled image before running migrations.

### Step 1: Backup Current Database (Optional but Recommended)

Even in development, backing up ensures you can recover if something goes wrong:

```bash
# Create backup directory
mkdir -p backups

# Dump current database
docker exec restaurant-guide-postgres pg_dump \
  -U postgres restaurant_guide_belarus \
  > backups/pre-postgis-backup-$(date +%Y%m%d-%H%M%S).sql

echo "Backup created: backups/pre-postgis-backup-*.sql"
```

### Step 2: Update docker-compose.yml

Open your `docker-compose.yml` file and modify the PostgreSQL service:

**BEFORE:**
```yaml
postgres:
  image: postgres:15.8
  container_name: restaurant-guide-postgres
  environment:
    POSTGRES_DB: restaurant_guide_belarus
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

**AFTER:**
```yaml
postgres:
  image: postgis/postgis:15-3.3  # Changed to PostGIS image
  container_name: restaurant-guide-postgres
  environment:
    POSTGRES_DB: restaurant_guide_belarus
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

**Key change:** `postgres:15.8` → `postgis/postgis:15-3.3`

This image includes PostgreSQL 15 with PostGIS 3.3 pre-installed.

### Step 3: Recreate Containers

Stop and remove the current PostgreSQL container, then start with new image:

```bash
# Stop all containers
docker-compose down

# Remove PostgreSQL volume (WARNING: This deletes data!)
# Only do this in development. In production, use pg_dump/pg_restore.
docker volume rm restaurant-guide-belarus_postgres_data

# Start with new image
docker-compose up -d postgres

# Wait for PostgreSQL to initialize (30-60 seconds)
sleep 30

# Verify PostGIS is available
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'postgis';"
```

**Expected output:**
```
   name   | default_version
----------+-----------------
 postgis  | 3.3.3
(1 row)
```

If you see this output, PostGIS is available and ready to use.

### Step 4: Restore Schema (If Starting Fresh)

If you deleted the volume, recreate the database schema:

```bash
# Run main schema creation script
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < docs/02_architecture/database_schema_v2.0.sql

echo "Schema recreated successfully"
```

### Version Compatibility Notes

- **PostgreSQL 15.x** + **PostGIS 3.3.x** is the recommended combination
- PostGIS 3.3 requires PostgreSQL 12+
- Older PostGIS 3.2 works but lacks some optimizations
- Do not use PostGIS 2.x - it's deprecated and lacks modern features

---

## Pre-Migration Checklist

Before executing migrations, verify these conditions:

### 1. PostGIS Availability

```bash
# Test PostGIS extension availability
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT PostGIS_Version();"
```

**Expected:** Version string like `3.3 USE_GEOS=1 USE_PROJ=1...`  
**If fails:** PostGIS not installed. Review "Switching to PostGIS Docker Image" section.

### 2. Database Connectivity

```bash
# Test database connection
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT version();"
```

**Expected:** PostgreSQL version output  
**If fails:** Check Docker container is running with `docker ps`

### 3. Verify Current Schema

```bash
# Check current establishments table columns
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "\d establishments"
```

**Expected:** Should show `latitude`, `longitude`, `categories`, `cuisines`, `working_hours`, `attributes` columns  
**If different:** Schema may have already been modified or is not from v2.0

### 4. Check for Existing Data

```bash
# Count establishments
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT COUNT(*) AS establishment_count FROM establishments;"
```

**Note the count.** If data exists, migrations will preserve and transform it.

### 5. Verify No Concurrent Migrations

Ensure no other migration processes are running:

```bash
# Check for locks on establishments table
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT pid, usename, query FROM pg_stat_activity WHERE query LIKE '%establishments%';"
```

**Expected:** Only your query should appear  
**If others exist:** Wait for them to complete or terminate if safe

### 6. Create Migration Log Directory

```bash
# Create directory for migration logs
mkdir -p backend/migrations/logs

echo "Migration logs will be stored in backend/migrations/logs/"
```

---

## Migration Execution

Execute migrations **in numerical order**. Each script is idempotent (safe to run multiple times).

### Script Locations

All migration scripts should be in `backend/migrations/`:

```
backend/migrations/
├── 002_enable_postgis.sql
├── 003_add_geography_column.sql
├── 004_rename_category_columns.sql
├── 005_add_new_columns.sql
└── 006_create_indexes.sql
```

### Execution Method 1: Using psql (Recommended)

Execute each migration with psql and log output:

```bash
# Navigate to project root
cd /path/to/restaurant-guide-belarus

# Execute Migration 002: Enable PostGIS
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/002_enable_postgis.sql \
  | tee backend/migrations/logs/002_enable_postgis.log

echo "✓ Migration 002 complete"

# Execute Migration 003: Add Geography Column
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/003_add_geography_column.sql \
  | tee backend/migrations/logs/003_add_geography_column.log

echo "✓ Migration 003 complete"

# Execute Migration 004: Rename Category Columns
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/004_rename_category_columns.sql \
  | tee backend/migrations/logs/004_rename_category_columns.log

echo "✓ Migration 004 complete"

# Execute Migration 005: Add New Columns
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/005_add_new_columns.sql \
  | tee backend/migrations/logs/005_add_new_columns.log

echo "✓ Migration 005 complete"

# Execute Migration 006: Create Indexes
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/006_create_indexes.sql \
  | tee backend/migrations/logs/006_create_indexes.log

echo "✓ Migration 006 complete"

echo "✅ All migrations executed successfully!"
```

### Execution Method 2: Batch Script

Create a bash script to run all migrations:

```bash
# Create migration runner script
cat > backend/migrations/run_migrations.sh << 'EOF'
#!/bin/bash
set -e

MIGRATIONS=(
  "002_enable_postgis"
  "003_add_geography_column"
  "004_rename_category_columns"
  "005_add_new_columns"
  "006_create_indexes"
)

echo "🚀 Starting migration sequence..."
echo ""

for migration in "${MIGRATIONS[@]}"; do
  echo "📋 Executing: ${migration}.sql"
  docker exec -i restaurant-guide-postgres psql \
    -U postgres -d restaurant_guide_belarus \
    < backend/migrations/${migration}.sql \
    | tee backend/migrations/logs/${migration}.log
  
  if [ $? -eq 0 ]; then
    echo "✓ ${migration} completed successfully"
  else
    echo "✗ ${migration} failed"
    exit 1
  fi
  echo ""
done

echo "✅ All migrations completed successfully!"
EOF

# Make executable
chmod +x backend/migrations/run_migrations.sh

# Run migrations
./backend/migrations/run_migrations.sh
```

### Expected Output Per Migration

**Migration 002 (Enable PostGIS):**
```
NOTICE: PostGIS extension is available. Proceeding with installation...
CREATE EXTENSION
NOTICE: PostGIS extension successfully enabled. Version: 3.3.3
     postgis_version     
-------------------------
 3.3 USE_GEOS=1 USE_PROJ=1...
```

**Migration 003 (Add Geography Column):**
```
NOTICE: Added location column with type GEOGRAPHY(Point, 4326)
NOTICE: Populated location column for N establishments
NOTICE: All establishments have valid location data
```

**Migration 004 (Rename Category Columns):**
```
NOTICE: Added category column (singular)
NOTICE: Populated category for N establishments
NOTICE: Renamed cuisines column to cuisine_type
NOTICE: Renamed working_hours column to operating_hours
NOTICE: Added features column as TEXT[]
NOTICE: Populated features from attributes for N establishments
```

**Migration 005 (Add New Columns):**
```
NOTICE: Added average_check_byn column with positive value constraint
NOTICE: Set default average_check_byn for N establishments based on price_range
NOTICE: Added is_24_hours column with default FALSE
NOTICE: Added primary_image_url column
```

**Migration 006 (Create Indexes):**
```
NOTICE: Created spatial GIST index on location column
NOTICE: Created B-tree index on category column
NOTICE: Created GIN index on cuisine_type array column
... (additional index creation notices)
```

---

## Post-Migration Verification

After completing all migrations, run these verification queries to confirm success.

### 1. Verify PostGIS Functionality

```bash
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT PostGIS_Version();"
```

**Expected:** `3.3 USE_GEOS=1 USE_PROJ=1...`

### 2. Verify Schema Structure

```bash
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'establishments' 
      AND column_name IN ('location', 'category', 'cuisine_type', 'operating_hours', 'features', 'average_check_byn', 'is_24_hours', 'primary_image_url')
      ORDER BY column_name;"
```

**Expected output:**
```
     column_name      |     data_type     |   udt_name
----------------------+-------------------+--------------
 average_check_byn    | numeric           | numeric
 category             | character varying | varchar
 cuisine_type         | ARRAY             | _text
 features             | ARRAY             | _text
 is_24_hours          | boolean           | bool
 location             | USER-DEFINED      | geography
 operating_hours      | jsonb             | jsonb
 primary_image_url    | text              | text
```

All 8 columns should be present with correct types.

### 3. Verify Indexes Created

```bash
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'establishments' 
      AND indexname LIKE 'idx_establishments_%'
      ORDER BY indexname;"
```

**Expected:** Should show at least these indexes:
- `idx_establishments_location` (GIST)
- `idx_establishments_category` (B-tree)
- `idx_establishments_cuisine_type` (GIN)
- `idx_establishments_price_range` (B-tree)
- `idx_establishments_subscription_tier` (B-tree)
- `idx_establishments_rating` (B-tree)
- `idx_establishments_features` (GIN)

### 4. Test Geography Functions

```bash
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT 
        name,
        ROUND(ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint(27.561831, 53.902496), 4326)::geography
        )::numeric) AS distance_meters
      FROM establishments
      WHERE location IS NOT NULL
      ORDER BY distance_meters
      LIMIT 5;"
```

**Expected:** List of establishments with distances in meters from Minsk center

### 5. Verify Data Integrity

```bash
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT 
        COUNT(*) AS total,
        COUNT(location) AS with_location,
        COUNT(category) AS with_category,
        COUNT(average_check_byn) AS with_check,
        COUNT(CASE WHEN is_24_hours = TRUE THEN 1 END) AS always_open
      FROM establishments;"
```

**Expected:** Counts should match or be close to total (depending on existing data)

---

## Rollback Procedures

If migration fails or issues are discovered, rollback scripts can reverse changes.

### When to Rollback

- Migration script failed partway through
- PostGIS functions not working correctly  
- Data transformation produced incorrect results
- Need to revise migration approach

### Rollback Sequence

Execute rollback scripts **in reverse order** (006 → 002):

```bash
# Rollback 006: Drop Indexes
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/006_rollback_indexes.sql

# Rollback 005: Remove New Columns
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/005_rollback_new_columns.sql

# Rollback 004: Revert Category Transformations
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/004_rollback_category_columns.sql

# Rollback 003: Remove Geography Column
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/003_rollback_geography_column.sql

# Rollback 002: Disable PostGIS (Optional)
docker exec -i restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  < backend/migrations/002_rollback_postgis.sql
```

### Rollback Limitations

**IMPORTANT:** Some rollbacks are **lossy** (cannot fully restore original state):

1. **Category transformation**: If establishments had multiple categories, the rollback recreates only the single category that was kept. The original array cannot be restored.

2. **Features transformation**: If attributes JSONB contained complex nested data, it cannot be reconstructed from the simple features array.

3. **New column data**: Rolling back 005 permanently deletes all data in `average_check_byn`, `is_24_hours`, and `primary_image_url` columns.

Original `latitude`, `longitude`, `categories`, `cuisines`, `working_hours`, and `attributes` columns are preserved during migration, so rolling back these is non-destructive.

---

## Troubleshooting

### Problem: PostGIS Extension Not Available

**Error message:**
```
ERROR: extension "postgis" is not available
```

**Cause:** PostgreSQL image does not include PostGIS

**Solution:**
1. Follow [Switching to PostGIS Docker Image](#switching-to-postgis-docker-image) section
2. Ensure you're using `postgis/postgis:15-3.3` image
3. Recreate containers with `docker-compose up -d`
4. Retry migration 002

### Problem: Permission Denied Creating Extension

**Error message:**
```
ERROR: permission denied to create extension "postgis"
```

**Cause:** Database user lacks CREATE EXTENSION privilege

**Solution:**
```bash
# Grant privilege to postgres user
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "ALTER USER postgres WITH SUPERUSER;"

# Retry migration 002
```

### Problem: Column Already Exists

**Error message:**
```
ERROR: column "location" of relation "establishments" already exists
```

**Cause:** Migration was partially completed before

**Solution:** Migrations are idempotent. The error is non-fatal if migration continues. Check migration output for "skipping creation" notices. If concerned, rollback and retry.

### Problem: Index Creation Very Slow

**Symptom:** Migration 006 takes more than 5 minutes

**Cause:** Large number of existing establishments or slow disk I/O

**Solution:** 
- Index creation is resource-intensive but only done once
- Wait for completion (can take 10-30 minutes with 10,000+ records)
- Monitor progress:
  ```bash
  docker exec restaurant-guide-postgres psql \
    -U postgres -d restaurant_guide_belarus \
    -c "SELECT now() - query_start AS duration, query 
        FROM pg_stat_activity 
        WHERE query LIKE '%CREATE INDEX%';"
  ```

### Problem: Geography Type Not Recognized

**Error message:**
```
ERROR: type "geography" does not exist
```

**Cause:** PostGIS extension not enabled

**Solution:**
```bash
# Verify PostGIS is enabled
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT extname FROM pg_extension WHERE extname = 'postgis';"

# If not found, run migration 002 again
```

### Problem: ST_Distance Returns NULL

**Symptom:** Distance calculations return NULL instead of meters

**Cause:** Location column has NULL values

**Solution:**
```bash
# Check for NULL locations
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT COUNT(*) FROM establishments WHERE location IS NULL;"

# If count > 0, check latitude/longitude values
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "SELECT id, name, latitude, longitude 
      FROM establishments 
      WHERE location IS NULL;"

# Update location for establishments with valid coordinates
docker exec restaurant-guide-postgres psql \
  -U postgres -d restaurant_guide_belarus \
  -c "UPDATE establishments 
      SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;"
```

---

## Post-Migration Tasks

After successful migration and verification, complete these tasks:

### 1. Run Updated Seed Script

Populate database with test establishments for development:

```bash
cd backend
npm run seed
```

**Expected output:**
```
🌱 Starting establishments seed process...
✓ Database connection established
✓ PostGIS available: 3.3
✓ Partner ID: [uuid]

Inserting 30 establishments...
✓ Inserted: Центральная кофейня
✓ Inserted: Бистро у площади
... (28 more)

✅ Seed complete! 30/30 establishments inserted

📊 Distribution Statistics:
   Total establishments: 30
   Free tier: 15 (50%)
   Basic tier: 8 (27%)
   Premium tier: 4 (13%)
   Featured tier: 3 (10%)
   24-hour establishments: 3
```

### 2. Test Search Endpoints

Verify Search and Discovery System works with new schema:

```bash
# Start backend server
cd backend
npm run dev

# In another terminal, test health endpoint
curl http://localhost:3000/api/v1/search/health

# Test basic search
curl "http://localhost:3000/api/v1/search/establishments?latitude=53.902496&longitude=27.561831&radius=5000"

# Test with filters
curl "http://localhost:3000/api/v1/search/establishments?latitude=53.902496&longitude=27.561831&radius=3000&category=restaurant&min_rating=4.5"
```

**Expected:** JSON responses with establishment arrays, properly sorted by distance and ranking score

### 3. Update Documentation

Update any documentation referencing the old schema:

- API documentation showing establishments structure
- Mobile app documentation for establishment data models
- Partner portal documentation for establishment management

### 4. Commit Migration Files

Add migration files to version control:

```bash
git add backend/migrations/*.sql
git add backend/migrations/logs/*.log
git add backend/scripts/seed-establishments.js
git commit -m "feat: Add PostGIS migration for establishments schema

- Enable PostGIS extension for geospatial functionality
- Add location geography column with spatial indexes
- Rename category columns for Search system alignment
- Add new required fields (average_check_byn, is_24_hours, primary_image_url)
- Create performance indexes for search optimization
- Update seed script for post-migration schema

This migration enables the Search and Discovery System with accurate
location-based queries and efficient spatial indexing."

git push origin main
```

### 5. Deploy to Staging (When Ready)

Test migration in staging environment before production:

1. Create staging database backup
2. Run migrations on staging
3. Run seed script on staging
4. Test all search endpoints thoroughly
5. Monitor performance and query times
6. If successful, schedule production migration

---

## Summary

This migration transforms the establishments table to support PostGIS-powered geospatial search. Key changes:

✅ **PostGIS extension enabled** for spatial functions  
✅ **Geography location column** added with spheroidal calculations  
✅ **Category columns renamed** for consistency with Search system  
✅ **New required fields** added for search functionality  
✅ **Performance indexes created** for sub-100ms query times  
✅ **Original data preserved** with ability to rollback if needed

The Search and Discovery System is now unblocked and ready for completion.

---

**Questions or Issues?**

If you encounter problems not covered in this guide:
1. Check migration logs in `backend/migrations/logs/`
2. Review PostgreSQL logs: `docker logs restaurant-guide-postgres`
3. Verify PostGIS version compatibility
4. Consult PostGIS documentation: https://postgis.net/docs/

For architecture questions, refer to the Migration Directive or contact the Architectural Coordinator (Ствол).

