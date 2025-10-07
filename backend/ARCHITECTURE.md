# Restaurant Guide Belarus - Backend Architecture Documentation

This document explains the architectural decisions, design patterns, and code organization principles used in the backend implementation. Understanding these concepts will help you contribute effectively to the project while maintaining consistency and code quality.

## Architectural Philosophy

The backend architecture is built on four core principles that guide all implementation decisions:

**Layered Architecture** separates concerns into distinct layers with clear responsibilities. Each layer has a specific role and communicates with adjacent layers through well-defined interfaces. This separation makes the codebase easier to understand, test, and modify without creating cascading changes throughout the system.

**Security First** means security considerations are embedded in every architectural decision rather than added as an afterthought. From password hashing with Argon2id to refresh token rotation to centralized input validation, security is treated as a fundamental requirement not an optional feature.

**Fail Fast** philosophy dictates that the application should detect and report configuration errors immediately at startup rather than failing mysteriously during operation. If the database is unreachable or the JWT secret is misconfigured, the application exits with clear error messages before accepting any requests. This prevents subtle bugs that are difficult to diagnose in production.

**Explicit Over Implicit** means code should be self-documenting and obvious in its intent. We favor verbosity that improves clarity over brevity that requires readers to infer meaning. Variable names describe what they contain, function names describe what they do, and comments explain why decisions were made.

## Project Structure

The codebase is organized into logical directories based on responsibility. Understanding this structure helps you quickly locate relevant code when implementing features or fixing bugs.

```
backend/
├── src/                          # All source code
│   ├── config/                   # External service configurations
│   │   ├── database.js          # PostgreSQL connection pooling
│   │   └── redis.js             # Redis client configuration
│   ├── controllers/             # HTTP request/response handlers
│   │   └── healthController.js  # Health check endpoint
│   ├── middleware/              # Request processing middleware
│   │   ├── auth.js              # JWT authentication & authorization
│   │   ├── rateLimiter.js       # Rate limiting implementation
│   │   └── errorHandler.js      # Centralized error handling
│   ├── models/                  # Database models (to be implemented)
│   ├── services/                # Business logic layer (to be implemented)
│   ├── routes/                  # API routing
│   │   ├── index.js            # Main router with version mounting
│   │   └── v1/                 # Version 1 routes
│   │       └── index.js        # V1 route definitions
│   ├── utils/                   # Shared utility functions
│   │   ├── logger.js           # Winston logging configuration
│   │   └── jwt.js              # JWT token generation/validation
│   └── server.js               # Application entry point
├── .env.example                 # Environment variable template
├── .eslintrc.json              # Code linting rules
├── .prettierrc                 # Code formatting rules
├── package.json                # Dependencies and scripts
├── SETUP.md                    # Setup instructions
└── ARCHITECTURE.md             # This document
```

## Layered Architecture Pattern

The application follows a strict layered architecture where each layer has specific responsibilities and can only communicate with adjacent layers. This pattern provides clear boundaries that prevent the codebase from becoming an incomprehensible tangle of interdependencies.

### Layer 1: Routes

Routes are the entry point for HTTP requests. They define URL patterns and HTTP methods, then delegate to controllers. Routes should be thin wrappers that do nothing except map URLs to controller functions and apply middleware.

**Responsibilities:**
- Define URL patterns and HTTP methods
- Apply middleware (authentication, rate limiting, validation)
- Delegate to controllers

**Example:**
```javascript
router.get('/establishments/:id', authenticate, establishmentController.getById);
```

Routes never contain business logic. They're pure glue code connecting HTTP to application logic.

### Layer 2: Controllers

Controllers handle the HTTP request/response cycle. They extract data from requests, call appropriate service methods, and format responses. Controllers understand HTTP concepts (status codes, headers) but know nothing about databases or business rules.

**Responsibilities:**
- Parse request data (params, query, body)
- Call service layer methods
- Format HTTP responses with appropriate status codes
- Handle HTTP-specific concerns (headers, cookies)

**Key principle:** Controllers should be readable as a high-level description of what happens for each endpoint, without getting bogged down in implementation details.

### Layer 3: Services

Services contain all business logic and orchestrate data operations. They implement the rules and workflows that define how the application works. Services understand domain concepts (users, establishments, reviews) but are independent of HTTP.

**Responsibilities:**
- Implement business rules and validation
- Orchestrate multiple database operations
- Coordinate between different models
- Return domain objects or throw domain-specific errors

**Example workflow:** Creating a review involves checking if the user already reviewed the establishment, validating the rating is between one and five, inserting the review, updating establishment metrics, and returning the created review. This workflow lives entirely in the service layer.

### Layer 4: Models

Models handle all database interactions. They know SQL and understand table structures, but nothing about business rules. Models are focused on efficient data access patterns and query optimization.

**Responsibilities:**
- Execute database queries
- Map between database rows and JavaScript objects
- Handle database-specific concerns (transactions, indexes)
- Return raw data without interpretation

**Key principle:** Models should provide reusable database operations that services can compose into business workflows.

### Layer 5: Utils

Utilities are pure functions that perform specific technical tasks. They have no dependencies on other layers and can be used anywhere in the application. Think of them as the standard library of the application.

**Responsibilities:**
- JWT token generation and validation
- Password hashing and comparison
- Date/time formatting
- String manipulation
- Logging configuration

Utilities should be stateless and side-effect-free where possible.

## Configuration Management

All environment-specific configuration is externalized through environment variables loaded from the `.env` file. This follows the twelve-factor app methodology, making the application easy to deploy across different environments without code changes.

**Database configuration** includes connection pool settings. The pool maintains persistent connections to PostgreSQL rather than opening new connections for each request, which would be prohibitively slow. Connection pooling is critical for performance under load.

**Redis configuration** includes reconnection strategies. If Redis becomes temporarily unavailable, the client automatically retries with exponential backoff rather than crashing. This resilience prevents cascading failures.

**JWT configuration** controls token lifetimes. Access tokens expire after fifteen minutes to limit the damage window if compromised, while refresh tokens last thirty days to avoid forcing users to log in constantly. This balance between security and user experience is configurable per environment.

**Rate limiting configuration** differs between authenticated and unauthenticated requests. Authenticated users get higher limits because we can identify and block individual abusers, while unauthenticated requests require stricter limits to prevent anonymous attacks.

## Security Architecture

Security is woven throughout the architecture at multiple layers. This defense-in-depth approach means that even if one security measure fails, others remain to protect the system.

### Authentication Flow

Authentication uses JWT access tokens for stateless verification. When a user logs in, they receive two tokens: a short-lived access token used for API requests, and a long-lived refresh token used to obtain new access tokens.

Access tokens are verified without database access by checking the JWT signature. This means authentication adds essentially zero latency to requests, which is critical for performance. The payload contains user ID, email, and role, which the middleware attaches to the request object for use by route handlers.

Refresh tokens implement strict rotation to prevent reuse attacks. When a refresh token is used, it's immediately invalidated and a new one is issued. If someone tries to reuse an old refresh token, this signals that the token was stolen, and we invalidate all tokens for that user, forcing them to log in again.

### Authorization Model

Authorization happens after authentication and checks if the user has permission for the requested action. The system uses role-based access control with three roles: regular users can create reviews and favorites, partners can manage their establishments, and admins can moderate content and access analytics.

Authorization is composable through the authorize middleware factory. You can require one specific role or allow multiple roles. This flexibility lets us implement complex access rules without duplicate code.

### Password Security

Passwords are hashed using Argon2id, which is specifically designed to resist modern attacks using GPU farms and specialized hardware. The parameters (sixteen megabytes memory cost, three iterations) are tuned to be slow enough to make brute force attacks impractical while fast enough not to impact user experience during login.

Never use MD5, SHA1, or even plain SHA256 for passwords. These algorithms are optimized for speed, which is exactly what you don't want for password hashing. An attacker with a modern GPU can test billions of SHA256 hashes per second, but only thousands of Argon2id hashes per second.

### Rate Limiting Strategy

Rate limiting implements a two-tier system based on authentication status. Authenticated users get one hundred requests per minute, which is generous for legitimate use but prevents individual accounts from overwhelming the system. Unauthenticated requests get three hundred requests per hour per IP address, which is strict enough to prevent abuse but loose enough not to affect legitimate users.

The implementation uses Redis for distributed rate limiting that works across multiple server instances. Each request increments a counter that automatically expires when the time window ends. This is more efficient than storing request timestamps and has better performance characteristics than database-based solutions.

### Input Validation

All user input must be validated before processing. The express-validator library provides middleware for common validation patterns like email format, string length, numeric ranges, and UUID format. Validation happens at the controller layer before data reaches services.

Parameterized queries prevent SQL injection by ensuring user input is never concatenated directly into SQL strings. The PostgreSQL driver treats parameters as data rather than code, making injection attacks impossible.

## Error Handling Strategy

Centralized error handling ensures all errors are logged consistently and returned to clients in a standard format. This makes the API predictable and easier to integrate with.

**AppError class** is used for expected errors with known status codes. When you throw an AppError, you're telling the error handler exactly how to respond to the client. This is for situations like "user not found" or "invalid input" where the error is part of normal application flow.

**Unexpected errors** like database connection failures or programming bugs are caught by the error handler and returned as generic five hundred status codes. The full error details are logged server-side for debugging, but clients only see a safe error message that doesn't expose implementation details.

**Validation errors** from express-validator are automatically formatted with details about which fields failed validation and why. This provides clients with actionable feedback without requiring custom error handling for each validation rule.

## Database Architecture

PostgreSQL is used with connection pooling for efficient resource utilization. The pool maintains persistent connections that are reused across requests rather than opening new connections constantly. This dramatically improves performance because establishing a database connection involves multiple round trips and authentication overhead.

**Prepared statements** are used for all queries through parameterized queries. This provides two benefits: security through SQL injection prevention, and performance through query plan caching by PostgreSQL.

**Transactions** are used for operations that must be atomic. The getClient function provides access to a client that can execute multiple queries as a single transaction. This ensures either all operations succeed or none do, maintaining data consistency.

**Indexes** are defined in the database schema to optimize common query patterns. The establishment search endpoint benefits from geospatial indexes for location queries, GIN indexes for array columns (categories, cuisines), and composite indexes for sorting by ranking score and rating.

## Redis Architecture

Redis serves multiple purposes in the architecture, all leveraging its in-memory performance and built-in data structures.

**Rate limiting** uses Redis counters with automatic expiration. This is more efficient than database-based rate limiting and works across multiple server instances. The atomic increment-and-expire operation ensures race conditions don't allow users to exceed limits.

**Session management** will store refresh tokens in Redis with automatic cleanup through TTL. This is more efficient than database storage for temporary session data that doesn't need durability guarantees.

**Caching** will use Redis to store frequently accessed data like popular establishments or search results. This reduces database load and improves response times for common queries.

## Logging Architecture

Structured logging with Winston provides consistent, searchable logs across the application. Logs are JSON-formatted in production for log aggregation tools and human-readable in development for debugging.

**Correlation IDs** enable request tracing by providing a unique identifier for each request that appears in all related log entries. This is critical for debugging issues in production where multiple requests are being processed concurrently.

**Sensitive data redaction** prevents passwords and tokens from appearing in logs. The logger automatically redacts fields like "password", "token", and "authorization" before writing log entries.

**Log levels** are used appropriately: debug for development information, info for normal operations, warn for issues that need attention but don't require immediate action, and error for serious problems requiring investigation.

## API Versioning Strategy

The API uses URL-based versioning through the /api/v1 prefix. This provides a clear migration path when breaking changes are needed. Version one can coexist with version two, allowing old clients to continue working while new clients adopt the updated API.

New versions are only created when breaking changes are necessary. Adding new optional fields or new endpoints doesn't require a version bump. This keeps the API stable for clients while allowing organic growth.

## Future Architectural Considerations

As the application scales, several architectural enhancements should be considered:

**Database read replicas** can offload read queries from the primary database when read traffic significantly exceeds write traffic. Most endpoints are reads (search, view details), so this provides substantial scaling potential.

**Caching layer** with Redis can dramatically reduce database load for frequently accessed data. Popular establishments, search results, and user profile information are good candidates for caching with short TTLs.

**Background job queue** will be needed for asynchronous operations like sending emails, generating reports, or processing image uploads. Bull queue with Redis backend is a good choice for this.

**Microservices extraction** might be warranted if certain domains (like image processing or analytics) grow large enough to justify independent scaling and deployment. However, this should only be done when proven necessary through real production metrics.

## Development Best Practices

When contributing code to this project, follow these practices to maintain architectural consistency:

Use async/await for all asynchronous operations rather than callbacks or raw promises. This makes code more readable and easier to reason about.

Keep functions small and focused on a single responsibility. If a function is doing multiple unrelated things, split it into multiple functions.

Write defensive code that validates assumptions. Don't assume database queries always succeed or user input is well-formed.

Add JSDoc comments to public functions explaining parameters, return values, and behavior. Future developers (including yourself) will thank you.

Follow the established layering pattern. Controllers call services, services use models, models execute queries. Don't shortcut these layers because it seems convenient in the moment.

Test your code with realistic data. Edge cases like empty strings, null values, maximum lengths, and special characters often reveal bugs that happy-path testing misses.

---

**Document Version**: 1.0  
**Last Updated**: September 30, 2025  
**Maintained By**: Backend Team