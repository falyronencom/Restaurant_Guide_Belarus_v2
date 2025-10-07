# Restaurant Guide Belarus - Backend Setup Guide

This document provides step-by-step instructions for setting up the backend development environment from scratch. Following these instructions, you'll have a fully functional local development server running.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js 18.x or higher** - JavaScript runtime
  - Check version: `node --version`
  - Download from: https://nodejs.org/

- **npm 9.x or higher** - Node package manager (comes with Node.js)
  - Check version: `npm --version`

- **PostgreSQL 15.x or higher** - Relational database with PostGIS extension
  - Check version: `psql --version`
  - Download from: https://www.postgresql.org/download/
  - **Important**: Install with PostGIS extension for geospatial functionality

- **Redis 7.x or higher** - In-memory data store for caching and rate limiting
  - Check version: `redis-cli --version`
  - Download from: https://redis.io/download/

- **Git** - Version control
  - Check version: `git --version`

## Step 1: Clone the Repository

```bash
git clone <repository-url>
cd restaurant-guide-belarus/backend
```

## Step 2: Install Dependencies

Navigate to the backend directory and install all required npm packages:

```bash
npm install
```

This will install all dependencies listed in `package.json`, including:
- Express web framework
- PostgreSQL client (pg)
- Redis client
- JWT authentication libraries
- Security middleware (helmet, cors)
- Logging utilities (winston, morgan)
- And all other required packages

## Step 3: Set Up PostgreSQL Database

### 3.1 Create Database

Connect to PostgreSQL and create the application database:

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Create database
CREATE DATABASE restaurant_guide_belarus;

# Enable PostGIS extension for geospatial queries
\c restaurant_guide_belarus
CREATE EXTENSION IF NOT EXISTS postgis;

# Exit psql
\q
```

### 3.2 Create Database User (Optional but Recommended)

For better security, create a dedicated database user:

```bash
psql -U postgres

CREATE USER rgb_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE restaurant_guide_belarus TO rgb_user;

\q
```

### 3.3 Run Database Migrations

Execute the database schema creation script to set up all tables, indexes, and triggers:

```bash
psql -U postgres -d restaurant_guide_belarus -f ../docs/02_architecture/database_schema_v2.0.sql
```

Verify tables were created:

```bash
psql -U postgres -d restaurant_guide_belarus -c "\dt"
```

You should see tables like `users`, `establishments`, `reviews`, etc.

## Step 4: Set Up Redis

### 4.1 Start Redis Server

Start the Redis server in the background:

```bash
# On macOS with Homebrew:
brew services start redis

# On Linux with systemd:
sudo systemctl start redis

# Or run directly in foreground for development:
redis-server
```

### 4.2 Verify Redis is Running

Test that Redis is accessible:

```bash
redis-cli ping
# Should return: PONG
```

## Step 5: Configure Environment Variables

Create your environment configuration file from the example template:

```bash
cp .env.example .env
```

Edit `.env` file with your actual configuration:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=restaurant_guide_belarus
DB_USER=postgres              # Or rgb_user if you created dedicated user
DB_PASSWORD=your_db_password  # CHANGE THIS
DB_MAX_CONNECTIONS=10
DB_MIN_CONNECTIONS=2

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                # Leave empty if no password set
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_at_least_32_characters_long  # CHANGE THIS - CRITICAL FOR SECURITY
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

# CORS Configuration
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
CORS_CREDENTIALS=true

# Logging
LOG_LEVEL=debug
LOG_FORMAT=json
```

**CRITICAL SECURITY NOTES:**

1. **JWT_SECRET**: Must be at least 32 characters long and completely random. Generate with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **DB_PASSWORD**: Never use default passwords in production. Use strong, unique passwords.

3. **Never commit `.env` file to version control**. It's already in `.gitignore`.

## Step 6: Start the Development Server

With all dependencies configured, start the server:

```bash
npm run dev
```

You should see log output indicating successful startup:

```
[timestamp] [info]: Starting Restaurant Guide Belarus Backend API
[timestamp] [info]: Testing database connection...
[timestamp] [info]: Database connection successful
[timestamp] [info]: Connecting to Redis...
[timestamp] [info]: Redis client ready
[timestamp] [info]: Server listening on port 3000
```

The server is now running at `http://localhost:3000`

## Step 7: Verify the Setup

Test that the server is responding correctly:

### 7.1 Health Check Endpoint

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-09-30T...",
    "uptime": 12.345,
    "checks": {
      "database": { "status": "healthy", "responseTime": 5 },
      "redis": { "status": "healthy", "responseTime": 2 },
      "memory": { "status": "healthy", "usage": {...} }
    },
    "responseTime": 10
  }
}
```

If all checks show "healthy", your setup is complete!

### 7.2 API Discovery Endpoint

```bash
curl http://localhost:3000/api
```

Expected response:
```json
{
  "success": true,
  "message": "Restaurant Guide Belarus API",
  "versions": {
    "v1": {
      "status": "active",
      "baseUrl": "/api/v1",
      "documentation": "/api/v1/docs"
    }
  }
}
```

## Common Setup Issues

### Issue: "JWT_SECRET must be at least 32 characters long"

**Solution**: Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and set it as JWT_SECRET in your `.env` file.

### Issue: "Database connection failed"

**Possible causes:**
1. PostgreSQL not running: `sudo systemctl start postgresql` (Linux) or `brew services start postgresql` (macOS)
2. Wrong credentials: Verify DB_USER and DB_PASSWORD in `.env`
3. Database doesn't exist: Run database creation commands from Step 3.1
4. Port conflict: Check if another process is using port 5432

### Issue: "Redis connection failed"

**Possible causes:**
1. Redis not running: `redis-server` or `brew services start redis`
2. Wrong port: Verify REDIS_PORT in `.env` matches your Redis configuration
3. Redis requires password but none provided in `.env`

### Issue: Port 3000 already in use

**Solution**: Either stop the conflicting process or change PORT in `.env`:
```env
PORT=3001
```

### Issue: "Cannot find module" errors

**Solution**: Delete node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Development Workflow

### Running the Server

```bash
# Development mode with auto-reload on file changes
npm run dev

# Production mode
npm start
```

### Code Quality

```bash
# Run ESLint to check code style
npm run lint

# Auto-fix linting issues
npm run lint -- --fix

# Format code with Prettier
npm run format
```

### Logs

Application logs are output to the console. In development mode, they're colorized and human-readable. In production, they're JSON-formatted for log aggregation tools.

Log levels (from most to least severe):
- **error**: Critical errors requiring immediate attention
- **warn**: Warning conditions that should be reviewed
- **info**: General informational messages about application flow
- **debug**: Detailed debugging information (only in development)

## Next Steps

Now that your backend is running:

1. **Review Architecture**: Read `ARCHITECTURE.md` to understand code organization
2. **Explore API**: Use Postman or curl to test the health check endpoint
3. **Database Inspection**: Use pgAdmin or psql to explore the database schema
4. **Begin Development**: Start implementing business logic endpoints

## Getting Help

If you encounter issues not covered in this guide:

1. Check application logs for detailed error messages
2. Verify all environment variables are correctly set
3. Ensure all prerequisite services (PostgreSQL, Redis) are running
4. Review the ARCHITECTURE.md document for context on system design
5. Contact the development team

---

**Document Version**: 1.0  
**Last Updated**: September 30, 2025  
**Maintained By**: Backend Team
