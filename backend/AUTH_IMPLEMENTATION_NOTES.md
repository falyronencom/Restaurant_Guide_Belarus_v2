# Authentication System Implementation Notes

**Implementation Date**: October 9, 2025  
**Implementer**: Leaf Session - Authentication & Security Expert  
**Status**: Complete - Ready for Integration

---

## Overview

This document captures the specific implementation decisions, architectural patterns, and guidance for the authentication system in Restaurant Guide Belarus. It serves as a companion to ARCHITECTURE.md, focusing on the "why" behind implementation choices rather than just the "what."

---

## Architecture Summary

The authentication system implements a JWT-based authentication flow with strict refresh token rotation. Users can register and login using email or phone with password. The system automatically logs users in after registration for smooth UX.

### Token Flow

```
Registration/Login → Generate Token Pair → Client Stores Tokens
                                                    ↓
Access Token (15 min) ←─────────────────────── API Requests
                                                    ↓
Token Expired? → Refresh Endpoint → New Token Pair → Continue
                                                    ↓
Token Reuse Detected? → Invalidate All Tokens → Force Re-auth
```

### Key Components

**Services Layer** (`src/services/authService.js`)
- All business logic for authentication
- Password hashing with Argon2id
- Token generation and validation
- User creation and credential verification

**Controllers Layer** (`src/controllers/authController.js`)
- HTTP request/response handling
- Thin orchestration between validation, services, and responses
- Error formatting for API consistency

**Validation Layer** (`src/validation/authValidation.js`)
- Comprehensive input validation using express-validator
- Belarus-specific phone number validation
- Password complexity enforcement
- Custom cross-field validation rules

**Routes Layer** (`src/routes/v1/authRoutes.js`)
- Declarative route definitions
- Middleware chain composition
- Endpoint-specific rate limiting

---

## Critical Implementation Decisions

### 1. Password Hashing: Argon2id with Specific Parameters

**Decision**: Use Argon2id algorithm with memory=16MB, time=3 iterations, parallelism=1

**Rationale**: 
- Argon2id is the winner of the Password Hashing Competition and provides superior resistance to GPU/ASIC attacks compared to bcrypt or PBKDF2
- The memory cost of 16MB makes parallel cracking attempts expensive, as each attempt requires 16MB of RAM
- Three iterations balance security with acceptable login latency (50-100ms on typical hardware)
- Parallelism of 1 is optimal for web server context where we want consistent, predictable performance

**Implementation**:
```javascript
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384, // 16MB in KB
  timeCost: 3,
  parallelism: 1
};

const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
```

**Future Considerations**:
- These parameters may need adjustment as hardware improves
- Monitor login latency in production and adjust if needed
- Consider progressive work factor increases for existing user passwords over time

---

### 2. Strict Refresh Token Rotation

**Decision**: Implement single-use refresh tokens that are immediately invalidated upon use

**Rationale**:
- Prevents token replay attacks where an attacker intercepts a refresh token and reuses it
- If a token is used twice, it indicates either token theft or a bug, both requiring security response
- The `used_at` timestamp allows us to detect reuse and invalidate all user sessions as security measure

**Implementation Flow**:
1. Client presents refresh token to `/auth/refresh` endpoint
2. Server checks `used_at` field in database
3. If `used_at` is NULL, token is valid:
   - Mark token as used (set `used_at = NOW()`)
   - Generate new token pair
   - Return new tokens to client
4. If `used_at` is NOT NULL, token was already used:
   - This is security incident
   - Invalidate ALL refresh tokens for user
   - Return 403 Forbidden
   - Log security alert

**Edge Cases Handled**:
- Race condition: Database transaction ensures atomic check-and-mark
- Network retry: Client receives new tokens, old token immediately invalidated
- Token theft: Legitimate user and attacker both try to use token, all sessions invalidated

---

### 3. Constant-Time Credential Verification

**Decision**: Always perform password hash verification even when user doesn't exist

**Rationale**:
- Prevents timing attacks where attacker measures response time to determine if email/phone exists
- If we returned immediately when user not found, attacker could enumerate valid accounts by measuring that response is faster
- By always performing hash verification (against dummy hash), response time is constant

**Implementation**:
```javascript
if (result.rows.length > 0) {
  const user = result.rows[0];
  isValidPassword = await argon2.verify(user.password_hash, password);
} else {
  // User not found, but perform dummy verification anyway
  await argon2.verify(
    '$argon2id$v=19$m=16384,t=3,p=1$dummysaltdummysalt$dummyhashdummyhashdummyhashdummy',
    password
  );
}
```

**Trade-offs**:
- Adds 50-100ms latency to failed login attempts
- This is acceptable because legitimate users rarely fail login repeatedly
- Security benefit of preventing account enumeration outweighs UX impact

---

### 4. Automatic Login After Registration

**Decision**: Registration endpoint returns JWT tokens immediately, logging user in

**Rationale**:
- Improves user experience by eliminating extra login step after registration
- Users can start using app immediately after creating account
- Industry standard pattern used by major apps (Twitter, Instagram, etc.)

**Security Consideration**:
- Email/phone verification happens asynchronously (future enhancement)
- Users can use app immediately but certain features may require verification
- This balances security with user experience for a restaurant discovery app

---

### 5. Differentiated Rate Limiting

**Decision**: Different rate limits for different auth endpoints

**Limits Applied**:
- **Register**: 20 requests/minute per IP
  - Moderate limit allowing multiple legitimate registrations from shared IP (coffee shop, office)
  - Still prevents automated account creation at scale
  
- **Login**: 10 requests/minute per IP
  - Strictest limit to prevent brute force password guessing
  - Allows 10 attempts if user forgets password, then forces cool-down
  
- **Refresh**: 50 requests/minute per IP
  - Higher limit because active users refresh frequently (every 15 min)
  - Still prevents token generation spam

- **Logout**: No additional limit
  - Already protected by authentication requirement
  - Authenticated users have higher default limits

**Implementation**:
```javascript
router.post('/login',
  createRateLimiter({
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'login'
  }),
  validateLogin,
  authController.login
);
```

---

### 6. Generic Error Messages for Security

**Decision**: Return same error message for "user not found" and "wrong password"

**Error Message**: "Invalid email/phone or password"

**Rationale**:
- Prevents username enumeration attacks
- If we said "User not found", attacker knows that email doesn't exist
- If we said "Wrong password", attacker knows email exists and can focus brute force on that account
- Generic message provides no information about what specifically was wrong

**User Experience Impact**:
- Slightly less helpful to legitimate users who mistype email
- Security benefit outweighs minor UX inconvenience
- Users can reset password if truly forgotten

---

### 7. Belarus-Specific Phone Validation

**Decision**: Support only Belarus phone numbers with specific operator codes

**Regex Pattern**: `^\+375(29|33|44|25)\d{7}$`

**Supported Operators**:
- 29: A1 (Velcom)
- 33: MTS
- 44: life:)
- 25: MTS (newer prefixes)

**Rationale**:
- App targets Belarus market specifically
- Validating format ensures data quality for future SMS verification
- Prevents spam registrations with fake international numbers
- Easy to extend if we expand to other markets

**Future Enhancement**:
- If we add Russian market, include +7 prefixes
- If we add Ukraine market, include +380 prefixes

---

### 8. Password Complexity Requirements

**Requirements**:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one digit
- No maximum length
- No special character requirement

**Rationale**:
- Research shows overly complex password requirements lead to predictable patterns (Password1!, Password2!)
- Users tend to reuse passwords when requirements are too strict
- Our requirements balance security with usability
- No special characters required because they don't significantly improve entropy for 8+ char passwords with mixed case and digits

**NIST Guidelines Alignment**:
- Our policy aligns with NIST SP 800-63B guidelines for consumer-facing applications
- Focuses on length and variety rather than specific character types

---

## Common Authentication Scenarios

### Scenario 1: New User Registration

```
1. User submits registration form with email/phone, password, name
2. Frontend sends POST to /api/v1/auth/register
3. Validation middleware checks all fields
4. Controller calls authService.createUser()
5. Service hashes password with Argon2id
6. Service inserts user into database with role='user'
7. Service generates access token (15 min) and refresh token (30 days)
8. Service stores refresh token in database
9. Controller returns user object + tokens
10. Frontend stores tokens and redirects to main app
```

**Error Paths**:
- Email already exists → 409 Conflict
- Phone already exists → 409 Conflict
- Validation fails → 422 Unprocessable Entity
- Rate limit exceeded → 429 Too Many Requests

### Scenario 2: User Login

```
1. User submits login form with email/phone and password
2. Frontend sends POST to /api/v1/auth/login
3. Rate limiter checks attempt count (max 10/minute)
4. Validation middleware checks format
5. Controller calls authService.verifyCredentials()
6. Service finds user by email/phone
7. Service performs constant-time password verification
8. Service updates last_login_at timestamp
9. Service generates new token pair
10. Controller returns user object + tokens
11. Frontend stores tokens and redirects to main app
```

**Error Paths**:
- Invalid credentials → 401 Unauthorized (same message whether user not found or wrong password)
- Rate limit exceeded → 429 Too Many Requests
- Account inactive → 401 Unauthorized

### Scenario 3: Token Refresh

```
1. Frontend detects access token expired (gets 401 from API)
2. Frontend sends POST to /api/v1/auth/refresh with refresh token
3. Controller calls authService.refreshAccessToken()
4. Service looks up refresh token in database
5. Service checks token not expired and not already used
6. Service marks old token as used (used_at = NOW())
7. Service generates new token pair
8. Service stores new refresh token in database
9. Controller returns new tokens + user info
10. Frontend updates stored tokens and retries original request
```

**Error Paths**:
- Refresh token not found → 401 Unauthorized
- Refresh token expired → 401 Unauthorized (user must login again)
- Refresh token already used → 403 Forbidden + ALL user tokens invalidated
- Account inactive → 401 Unauthorized

### Scenario 4: Token Reuse Attack Detection

```
1. Attacker intercepts user's refresh token
2. Attacker uses token to get new tokens
3. Legitimate user tries to refresh with same token
4. Server detects used_at is not NULL
5. Server identifies this as security incident
6. Server invalidates ALL refresh tokens for user
7. Server returns 403 Forbidden to both attacker and user
8. Both must re-authenticate with password
9. Security team reviews logs for token interception vector
```

This aggressive response protects user accounts at cost of minor inconvenience if token reuse was innocent (network retry).

### Scenario 5: User Logout

```
1. User clicks logout button in app
2. Frontend sends POST to /api/v1/auth/logout with refresh token
3. Authenticate middleware verifies access token in header
4. Controller calls authService.invalidateRefreshToken()
5. Service marks refresh token as used
6. Controller returns success message
7. Frontend deletes stored tokens
8. Frontend redirects to login page
```

**Note**: Access token continues working until natural expiration (15 minutes). This is acceptable given short lifetime. The important security measure is invalidating refresh token so it can't be used to generate new access tokens.

---

## Integration Instructions

### Required Files to Create

1. **src/services/authService.js** - Business logic (see artifact)
2. **src/controllers/authController.js** - HTTP handlers (see artifact)
3. **src/validation/authValidation.js** - Input validation (see artifact)
4. **src/routes/v1/authRoutes.js** - Route definitions (see artifact)

### Required Modification

**src/routes/v1/index.js** - Mount auth routes:

```javascript
import express from 'express';
import { healthCheck } from '../../controllers/healthController.js';
import authRoutes from './authRoutes.js'; // ADD THIS LINE

const router = express.Router();

router.get('/health', healthCheck);
router.use('/auth', authRoutes); // ADD THIS LINE

export default router;
```

### Environment Variables Required

The authentication system uses these environment variables (should already be set):

```
JWT_SECRET=<32+ character random string>
JWT_REFRESH_SECRET=<32+ character random string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
```

### Database Prerequisites

The authentication system requires these tables (should already exist):

- `users` table with columns: id, email, phone, password_hash, name, role, auth_method, is_active, last_login_at, created_at, updated_at
- `refresh_tokens` table with columns: id, user_id, token, expires_at, created_at, used_at

See `docs/02_architecture/database_schema_v2.0.sql` for complete schema.

---

## Testing Guidance

While formal tests are not implemented in this session, here are the critical test scenarios:

### Unit Tests (Services Layer)

1. **Password Hashing**:
   - Verify Argon2id parameters are correct
   - Verify same password produces different hashes (salt randomness)
   - Verify hash verification works correctly

2. **User Creation**:
   - Verify user created with correct default role
   - Verify email normalized to lowercase
   - Verify duplicate email throws correct error
   - Verify duplicate phone throws correct error

3. **Credential Verification**:
   - Verify correct credentials return user object
   - Verify wrong password returns null
   - Verify non-existent user returns null
   - Verify timing is constant (difficult to test but important)

4. **Token Pair Generation**:
   - Verify tokens have correct expiration times
   - Verify refresh token stored in database
   - Verify access token contains correct payload

5. **Token Refresh**:
   - Verify valid refresh token returns new pair
   - Verify expired token throws error
   - Verify already-used token throws error and invalidates all tokens
   - Verify atomicity of check-and-mark operation

### Integration Tests (Controllers + Services)

1. **Registration Endpoint**:
   - POST valid data returns 201 with tokens
   - POST duplicate email returns 409
   - POST invalid email format returns 422
   - POST weak password returns 422

2. **Login Endpoint**:
   - POST valid credentials returns 200 with tokens
   - POST invalid credentials returns 401
   - POST exceeding rate limit returns 429
   - Verify generic error message doesn't reveal account existence

3. **Refresh Endpoint**:
   - POST valid refresh token returns 200 with new tokens
   - POST expired token returns 401
   - POST used token returns 403 and invalidates all tokens
   - POST invalid token returns 401

4. **Logout Endpoint**:
   - POST without auth returns 401
   - POST with valid auth returns 200
   - Verify refresh token invalidated after logout

5. **Me Endpoint**:
   - GET without auth returns 401
   - GET with valid auth returns 200 with user data
   - GET with expired token returns 401

---

## Security Considerations for Future Development

### Areas Requiring Monitoring

1. **Login Attempt Patterns**:
   - Monitor for distributed brute force attacks (many IPs, same email)
   - Alert on repeated failures from single IP
   - Consider progressive delays after N failures

2. **Token Reuse Incidents**:
   - All token reuse events should be investigated
   - May indicate token interception or MITM attacks
   - Consider additional logging of IP addresses and user agents

3. **Registration Patterns**:
   - Monitor for sudden spikes in registrations
   - Check for patterns indicating bot activity
   - Consider CAPTCHA for registration if abuse detected

### Future Enhancements

1. **Email Verification**:
   - Send confirmation email after registration
   - Limit certain features until email verified
   - Add resend verification email endpoint

2. **Phone Verification**:
   - SMS verification code flow
   - Required for phone-based authentication
   - Integrate with SMS provider (Twilio, Vonage)

3. **Password Reset**:
   - Forgot password flow with email link
   - Time-limited reset tokens
   - Password reset history

4. **OAuth Integration**:
   - Google OAuth for "Sign in with Google"
   - Yandex OAuth for Russian market
   - Minimal data storage (only identity, never access tokens)

5. **Two-Factor Authentication**:
   - TOTP-based 2FA for partner and admin accounts
   - SMS-based 2FA as alternative
   - Backup codes for account recovery

6. **Account Security Features**:
   - Active sessions list
   - Ability to revoke specific sessions
   - Login notifications via email
   - Password change history

7. **Advanced Rate Limiting**:
   - Device fingerprinting for stricter limits
   - Behavioral analysis for bot detection
   - CAPTCHA challenges after suspicious activity

---

## Troubleshooting Common Issues

### Issue: "Rate limit exceeded" on legitimate traffic

**Symptoms**: Users getting 429 errors during normal usage

**Causes**:
- Multiple users behind same corporate NAT/proxy (same IP)
- Very active user hitting endpoints frequently
- Rate limit configuration too strict

**Solutions**:
- Review rate limit logs to understand traffic patterns
- Consider increasing limits for specific endpoints
- Implement user-based rate limiting for authenticated endpoints
- Add CAPTCHA as alternative to blanket rejection

### Issue: "Invalid refresh token" errors

**Symptoms**: Users forced to re-login frequently

**Causes**:
- Clock skew between servers causing expiration issues
- Database query errors during token lookup
- Tokens not properly stored in database
- Tokens accidentally deleted from database

**Debug Steps**:
1. Check database for refresh_tokens table records
2. Verify expires_at timestamps are future dates
3. Check used_at field to see if tokens marked as used
4. Review application logs for token generation errors
5. Verify JWT_REFRESH_SECRET hasn't changed

### Issue: Slow login/registration performance

**Symptoms**: Login takes more than 500ms consistently

**Causes**:
- Argon2id parameters too aggressive for hardware
- Database connection pool exhausted
- Database queries missing indexes
- Network latency to database

**Debug Steps**:
1. Measure password hashing time separately
2. Check database connection pool metrics
3. Review slow query logs
4. Consider adjusting Argon2id parameters (reduce timeCost)

### Issue: Users can't login after password change

**Symptoms**: Correct new password rejected

**Causes**:
- Old password hash still in database
- Transaction rollback during password update
- Password hash verification using wrong algorithm parameters

**Debug Steps**:
1. Verify password_hash field updated in database
2. Check database transaction logs
3. Manually test hash verification with new hash
4. Verify ARGON2_OPTIONS haven't changed

---

## Performance Characteristics

### Expected Latencies (P50/P95/P99)

**Registration**: 100ms / 200ms / 500ms
- Dominated by Argon2id hashing (50-100ms)
- Database insert typically fast (< 10ms)
- Token generation negligible (< 5ms)

**Login**: 100ms / 200ms / 500ms
- Same as registration (password verification takes similar time as hashing)
- Database query typically fast with indexes
- Last login timestamp update is async

**Refresh**: 20ms / 50ms / 100ms
- Faster than login because no password hashing
- Database query for token lookup
- Token generation
- Database insert for new refresh token

**Logout**: 10ms / 30ms / 100ms
- Simple database update to mark token as used
- No cryptographic operations needed

### Scaling Considerations

**Database Queries**:
- All queries use connection pool (2-10 connections)
- Indexes on email, phone, refresh_tokens.token fields
- No N+1 queries (each endpoint makes at most 3 DB queries)

**Memory Usage**:
- Argon2id configured for 16MB per hash operation
- With 10 concurrent logins, memory usage = 160MB
- Normal request handling adds ~50MB baseline
- Total memory footprint for auth: ~200-250MB

**Redis Usage**:
- Rate limiting counters stored in Redis
- Automatic expiration prevents memory leaks
- Typical key size: 100 bytes
- 10K active rate limit keys = 1MB Redis memory

---

## Code Maintenance Guidelines

### When to Update Argon2id Parameters

Monitor these metrics in production:

- Average login latency
- CPU usage during auth operations
- Security advisories for Argon2id

Update parameters if:
- Hardware improves significantly (e.g., CPUs 2x faster)
- Security research recommends higher work factors
- User complaints about slow login performance

**Process**:
1. Test new parameters in staging
2. Measure latency impact
3. Update ARGON2_OPTIONS in code
4. Deploy gradually (canary deployment)
5. Monitor error rates and latency

### When to Rotate JWT Secrets

Rotate secrets if:
- Secret accidentally exposed in logs or code
- Employee with access to secrets leaves company
- Security audit recommends rotation
- Regular rotation policy (e.g., quarterly)

**Process**:
1. Generate new JWT_SECRET and JWT_REFRESH_SECRET
2. Deploy new secrets to environment variables
3. Old tokens remain valid until natural expiration
4. Monitor error rates for token validation failures
5. Document rotation date and reason

### When to Adjust Rate Limits

Review rate limits quarterly or when:
- Traffic patterns change significantly
- New abuse patterns detected
- Legitimate users affected by limits
- Business requirements change (e.g., marketing campaign)

**Process**:
1. Analyze rate limit rejection logs
2. Identify false positives (legitimate traffic blocked)
3. Adjust limits incrementally
4. Monitor impact over 1 week
5. Document changes and rationale

---

## Conclusion

The authentication system provides a secure, scalable foundation for user identity management in Restaurant Guide Belarus. The implementation balances security best practices with practical usability concerns, following modern standards while remaining pragmatic about the application's needs as a restaurant discovery app rather than a banking application.

Key strengths:
- Strong password hashing resistant to modern attacks
- Strict token rotation preventing replay attacks
- Constant-time operations preventing timing attacks
- Differentiated rate limiting preventing abuse
- Clean separation of concerns for maintainability

Future enhancements can build on this foundation to add email verification, OAuth integration, password reset flows, and other features as the application grows.

---

**Document Version**: 1.0  
**Last Updated**: October 9, 2025  
**Next Review**: After first production deployment

