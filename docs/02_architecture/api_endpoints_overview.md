# API Endpoints Overview v2.0 - Restaurant Guide Belarus

**Updated**: September 30, 2025  
**Version**: 2.0 with critical architectural improvements

## Version 2.0 Changes Summary

This version implements critical improvements identified through architectural review:
- **Ranking System**: Redesigned to weighted multi-factor algorithm preventing pay-to-win perception
- **Security**: Enhanced with IP-based rate limiting, strict refresh token rotation, explicit password hashing
- **Mobile Performance**: Progressive loading support reducing initial payload from 60KB to 8KB
- **Transparency**: New ranking breakdown endpoint for partners to understand subscription value

---

## Functional Areas and Endpoints Distribution

### 🔐 Authentication & User Management (10 endpoints)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| POST | `/auth/register` | Public | **v2.0** | User registration with Argon2id password hashing |
| POST | `/auth/login` | Public | **v2.0** | Login with enhanced rate limiting |
| POST | `/auth/refresh` | Public | **v2.0 🔄** | JWT refresh with strict token rotation security |
| POST | `/auth/logout` | Authenticated | v2.0 | Secure logout with token invalidation |
| POST | `/auth/oauth/google` | Public | **v2.0 ✨** | Google OAuth with minimal data storage |
| POST | `/auth/oauth/yandex` | Public | **v2.0 ✨** | Yandex OAuth with minimal data storage |
| GET | `/users/profile` | User, Partner, Admin | v2.0 | Get current user profile |
| PUT | `/users/profile` | User, Partner, Admin | v2.0 | Update user profile information |

**v2.0 Security Enhancements:**
- **Strict Token Rotation**: Refresh tokens are single-use and immediately invalidated upon refresh. Attempted reuse triggers security alert and invalidates all user sessions.
- **Password Hashing**: Explicit Argon2id algorithm (memory=16MB, iterations=3, parallelism=1) preventing GPU/ASIC attacks.
- **OAuth Best Practices**: Provider access tokens never stored. Only user identity data (email, name, provider_user_id) persisted.
- **IP-Based Rate Limiting**: 300 requests/hour per IP for unauthenticated endpoints, protecting against DDoS attacks.

---

### 🏪 Establishment Discovery (4 endpoints)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| GET | `/establishments/search` | Public | **v2.0 🔄** | Search with intelligent multi-factor ranking |
| GET | `/establishments/{id}` | Public | **v2.0 🔄** | Details with progressive loading support |
| GET | `/establishments/{id}/ranking` | Partner, Admin | **v2.0 ✨** | Ranking score transparency breakdown |

**v2.0 Critical Algorithm Redesign:**

The search ranking system has been completely redesigned to balance user trust with partner incentivization. The previous additive formula created mathematical inconsistencies and risked pay-to-win perception.

**New Weighted Multi-Factor Algorithm:**
```
Final_Score = (Distance_Factor × 0.35) + (Quality_Factor × 0.40) + (Subscription_Factor × 0.25)

Components:
Distance_Factor = 100 × (1 - actual_distance / max_radius)
Quality_Factor = (rating/5.0 × 50) + (min(review_count,200)/200 × 50)  
Subscription_Factor = tier_value  // free=0, basic=15, standard=35, premium=50
```

**Why This Matters:**

The algorithm ensures that proximity and quality remain dominant ranking signals worth seventy-five percent of the total score combined, while paid subscriptions provide meaningful but bounded influence at twenty-five percent. This prevents scenarios where distant lower-quality restaurants with Premium subscriptions outrank nearby excellent free listings, which would erode user trust.

**Contextual Weight Adaptation:**
- Default balanced weights: distance=0.35, quality=0.40, subscription=0.25
- User sorts by rating: quality increases to 0.60, distance reduces to 0.25
- High GPS velocity detected: distance increases to 0.50 (user moving quickly needs immediate nearby options)

This intelligent adaptation makes the ranking feel personalized rather than mechanical.

**Transparency Feature:**
New `/establishments/{id}/ranking` endpoint provides detailed score breakdown showing exactly how distance, quality, and subscription factors contribute to final ranking. Available to partners viewing their own establishments and admins. This transparency helps partners understand subscription value and identify improvement areas.

---

### 📱 Progressive Loading Enhancement (v2.0)

The detailed establishment endpoint now supports staged loading for mobile performance optimization:

**Loading Strategy:**
```
Stage 1: GET /establishments/{id}
Response: ~8KB (loads in <1 second on 3G)
Contains: Basic info, today's hours, primary image, rating summary

Stage 2: GET /establishments/{id}?include=media  
Response: +30-50KB
Contains: Full photo gallery

Stage 3: GET /establishments/{id}?include=reviews
Response: +15-20KB  
Contains: Recent reviews

Stage 4: GET /establishments/{id}?include=promotions
Response: +5-10KB
Contains: Active promotions

Desktop: GET /establishments/{id}?include=all
Response: ~60-80KB (everything in one request)
```

**Performance Impact:**

Mobile users see the establishment screen instantly with core information in under one second, creating perception of lightning-fast app even on poor networks. Additional content loads progressively as user scrolls, exactly when needed. This eliminates wasted bandwidth for content users may never view while maintaining the convenience of combined responses when appropriate.

---

### ⭐ User Interactions (5 endpoints)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| GET | `/favorites` | User, Partner | v2.0 | User's favorite establishments list |
| POST | `/favorites/{establishment_id}` | User, Partner | v2.0 | Add to favorites (optimistic UI recommended) |
| DELETE | `/favorites/{establishment_id}` | User, Partner | v2.0 | Remove from favorites |
| GET | `/establishments/{id}/reviews` | Public | v2.0 | Get establishment reviews |
| POST | `/establishments/{id}/reviews` | User, Partner | v2.0 | Create review (triggers real-time metric updates) |

---

### 🤝 Partner Management (4 endpoints)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| POST | `/partner/register` | Public | v2.0 | Partner registration with document verification |
| GET | `/partner/establishments` | Partner | v2.0 | Partner's establishment portfolio |
| POST | `/partner/establishments` | Partner | v2.0 | Create new establishment |
| GET | `/partner/establishments/{id}/analytics` | Partner | v2.0 | Detailed analytics dashboard |

---

### 🖼️ Media Management (1 endpoint)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| POST | `/media/upload` | Partner | **v2.0 🔄** | Upload with automatic WebP optimization |

**v2.0 Image Optimization:**

All uploaded images automatically include Cloudinary optimization parameters:
- `f_auto`: Automatic format selection (WebP for modern clients with 25-35% size reduction, JPEG fallback for older clients)
- `q_auto`: Content-aware quality optimization
- `fl_progressive`: Progressive JPEG encoding for faster perceived loading

**Bandwidth Impact:**

WebP format provides twenty-five to thirty-five percent smaller file sizes compared to JPEG at equivalent visual quality. For a platform where images dominate data transfer, this translates to meaningfully faster load times and reduced mobile data consumption. Combined with progressive encoding, users see low-quality image preview that gradually sharpens rather than slow top-to-bottom loading.

---

### 👑 Administrative Panel (3 endpoints)
| Method | Endpoint | Role Access | Status | Description |
|--------|----------|-------------|--------|-------------|
| GET | `/admin/establishments/pending` | Admin | v2.0 | Moderation queue management |
| POST | `/admin/establishments/{id}/moderate` | Admin | v2.0 | Moderation actions with audit logging |
| GET | `/admin/analytics/dashboard` | Admin | v2.0 | Platform-wide analytics |

---

## Rate Limiting Strategy (v2.0 Enhanced)

**Two-Tier Protection:**

### Authenticated Users
- **Limit**: 100 requests per minute
- **Key**: `ratelimit:user:{user_id}:minute`
- **TTL**: 1 minute auto-expiration in Redis
- **Sufficient for**: Normal mobile app usage including rapid scrolling

### Unauthenticated Users (IP-Based)
- **Limit**: 300 requests per hour per IP
- **Key**: `ratelimit:ip:{ip_address}:hour`  
- **TTL**: 1 hour auto-expiration in Redis
- **Calibrated for**: ~6 users per shared IP (common in Belarus carrier-grade NAT)
- **Protection**: Blocks script-based DDoS attacks while allowing legitimate browsing

**Implementation:**
```
Redis counter increment on each request
Reject if counter exceeds threshold
Automatic expiration prevents storage bloat
Scales horizontally with Redis cluster
```

**Error Response:**
```json
{
  "success": false,
  "message": "Превышен лимит запросов",
  "error_code": "RATE_LIMIT_EXCEEDED",
  "details": {
    "limit": 300,
    "window": "1 hour",
    "retry_after": 3600,
    "reset_at": "2025-09-30T14:00:00Z"
  }
}
```

---

## Security Architecture (v2.0)

### Token Rotation Security

**The Problem:**
Traditional refresh token systems where tokens remain valid for full thirty-day period create vulnerability window. If a refresh token is stolen through device compromise or network interception, attacker can maintain access alongside legitimate user for weeks without detection.

**The Solution:**
Strict single-use refresh token rotation implemented in v2.0. Each time a refresh token is exchanged for new access token, the old refresh token is immediately invalidated and new refresh token issued. The `refresh_tokens` table tracks usage:

```sql
ALTER TABLE refresh_tokens 
ADD COLUMN used_at TIMESTAMP,
ADD COLUMN replaced_by UUID REFERENCES refresh_tokens(id);
```

**Security Alert:**
If system detects attempt to reuse an already-consumed refresh token (used_at is not null), this is security signal indicating likely token theft. Response: immediate invalidation of all active sessions for that user and forced re-authentication.

**Client Implementation:**
Mobile apps must store both access and refresh tokens securely and replace old refresh token with new one immediately upon successful refresh. Failure to update stored refresh token will result in authentication failure on next refresh attempt.

### Password Hashing Standard

**Algorithm**: Argon2id (winner of Password Hashing Competition 2015)

**Parameters**:
- Memory cost: 16 megabytes
- Time cost: 3 iterations
- Parallelism: 1

**Why Argon2id:**
Specifically designed to resist both GPU and ASIC attacks. Memory-hard construction makes parallel brute-force attacks economically infeasible. Even with access to database, modern attack hardware would require months to crack well-chosen passwords.

**Storage Format:**
```
$argon2id$v=19$m=16384,t=3,p=1$c29tZXNhbHQ$hash_output_here
```

Full hash string includes algorithm identifier and parameters, enabling future algorithm upgrades by rehashing passwords on successful login.

### OAuth Data Minimization

**Requested Scopes:**
- Google: `email` and `profile` only
- Yandex: `login:email` and `login:info` only

**Critical Security Practice:**
Provider access tokens are NEVER stored in database after authentication completes. These tokens grant access to user data on provider platforms and represent severe security liability if database is compromised.

**Storage Policy:**
After successful OAuth flow, system stores only:
- User email (for account matching)
- User name (for display)
- Provider identifier (google/yandex)
- Provider's unique user ID (for identifying returning users)

Provider access token is discarded immediately after fetching user identity. This eliminates risk of token misuse if database is breached.

---

## Mobile Optimization Best Practices

### Progressive Loading Pattern

**Initial Request:**
```
GET /establishments/{id}
```

Shows establishment screen instantly with essential information in ~8KB response. User can immediately assess if this is what they're looking for.

**As User Scrolls:**
```javascript
// User scrolls to photo gallery section
if (userScrolledToPhotos && !photosLoaded) {
  fetch(`/establishments/${id}?include=media`)
}

// User scrolls to reviews section  
if (userScrolledToReviews && !reviewsLoaded) {
  fetch(`/establishments/${id}?include=reviews`)
}
```

Content loads exactly when needed, creating seamless experience while minimizing wasted bandwidth.

### Image Format Strategy

**Automatic WebP Delivery:**
All image URLs include `f_auto` parameter instructing Cloudinary to detect client capabilities and serve optimal format. Modern Flutter image rendering engine supports WebP, receiving 25-35% smaller files automatically. Older clients receive JPEG fallback without code changes.

**Progressive Loading:**
`fl_progressive` parameter ensures images load with blurred preview that gradually sharpens, rather than traditional top-to-bottom slow appearance. This creates perception of faster loading even on identical network speeds.

### Caching Strategy

**Response Caching (Redis):**
- Basic establishment info: 5 minute TTL (slowly changing)
- Media gallery: 15 minute TTL (changes infrequently)
- Reviews: 2 minute TTL (more dynamic)
- Search results: 5 minute TTL for popular queries

**Cache Invalidation:**
When partner uploads new photo, invalidate only media cache, not entire establishment cache. Granular invalidation prevents unnecessary cache misses.

**Client-Side Caching:**
Leverage HTTP caching headers (ETags, Last-Modified) for client-side caching. Server returns 304 Not Modified when content unchanged, eliminating redundant data transfer.

---

## Database Schema Updates (v2.0)

### Ranking Score Optimization

**New Computed Columns:**
```sql
ALTER TABLE establishments 
ADD COLUMN distance_score INTEGER DEFAULT 0,
ADD COLUMN quality_score INTEGER DEFAULT 0,
ADD COLUMN computed_rank INTEGER DEFAULT 0,
ADD COLUMN rank_updated_at TIMESTAMP;

CREATE INDEX idx_establishments_computed_rank 
ON establishments(computed_rank DESC, average_rating DESC);
```

**Background Job Strategy:**
Ranking scores are pre-computed to avoid expensive real-time calculations on every search request:
- Active establishments: Recalculated every 15 minutes
- Inactive/draft establishments: Recalculated hourly

This provides fresh rankings while maintaining sub-100ms search response times even under heavy load.

### Refresh Token Security

**Enhanced Token Tracking:**
```sql
ALTER TABLE refresh_tokens 
ADD COLUMN used_at TIMESTAMP,
ADD COLUMN replaced_by UUID REFERENCES refresh_tokens(id);
```

Tracks token consumption enabling detection of token reuse attacks. The `replaced_by` column creates audit trail showing token rotation history.

---

## Integration Recommendations for Backend Team

### Critical Implementation Priorities

**Phase 1: Security Foundation (Week 1-2)**
Implement authentication system with Argon2id password hashing and strict refresh token rotation. This foundation must be secure from day one as retrofit would require password reset for all users. Set up Redis infrastructure for rate limiting with proper monitoring of hit rates.

**Phase 2: Ranking Algorithm (Week 2-3)**
Implement multi-factor weighted ranking system with background job for score computation. Add comprehensive logging of score components to validate algorithm behavior matches specification. Create admin endpoint for viewing ranking breakdowns to assist debugging unexpected results.

**Phase 3: Progressive Loading (Week 3-4)**
Implement staged endpoint responses with optional include parameters. Configure Cloudinary with f_auto, q_auto, and fl_progressive parameters for all image URLs. Test thoroughly with mobile clients on simulated 3G networks to verify performance improvements.

### Testing Recommendations

**Security Testing:**
- Verify Argon2id parameters using test vectors from official specification
- Test refresh token rotation by attempting reuse of consumed tokens
- Validate rate limiting using concurrent request bombardment
- Confirm OAuth tokens are never persisted in database logs or backups

**Ranking Algorithm Testing:**
Create fixture establishments with known characteristics and verify ranking calculations:
```
Example Test Case:
Establishment A: 500m away, rating 4.8 (200 reviews), Premium tier
Establishment B: 3000m away, rating 4.2 (15 reviews), Free tier  

Expected: A ranks higher despite both having quality establishments
Validates proximity and review quantity factors outweigh subscription tier
```

**Performance Testing:**
- Measure search response times with 1000+ establishments in database
- Verify computed rank index is being used (check EXPLAIN ANALYZE)
- Test progressive loading payloads match size specifications (±10%)
- Confirm WebP format is delivered to modern clients

### Monitoring and Observability

**Key Metrics:**
- Rate limit hit rates per IP (alert if >80% of IPs hitting limits)
- Refresh token reuse attempts (security incidents)
- Search response time p95 (<200ms target)
- Ranking score computation job duration (<30 seconds target)
- Image load times by format and resolution

**Alerting Thresholds:**
- Token reuse detected: Immediate security alert
- Search response time >500ms: Performance degradation alert
- Rate limit hits >50% legitimate IPs: Consider limit adjustment
- Ranking job failures: Data inconsistency alert

---

## Changelog and Migration Path

### Breaking Changes
None. Version 2.0 maintains full backward compatibility with v1.0 clients while adding new functionality. Existing mobile apps continue working without updates.

### Recommended Client Updates
Mobile applications should update to leverage:
- Progressive loading for faster perceived performance
- New OAuth endpoints for simplified authentication
- Ranking transparency endpoint for partner apps
- Enhanced error messages with rate limit details

### Database Migrations
Required migrations executed in this order:
1. Add refresh token tracking columns (zero downtime)
2. Add ranking score computed columns (zero downtime)
3. Create new indexes (may cause brief query slowdown during creation)
4. Deploy background job for rank computation
5. Deploy updated API with new endpoints

---

## Future Optimization Opportunities (Post-MVP)

These enhancements are not critical for launch but should be considered after validating core product with real users:

**Search Query Caching**: Cache popular searches like "restaurants in central Minsk" in Redis with 5-minute TTL. Could reduce database load by 60-70% for read operations.

**Elasticsearch Integration**: As catalog grows beyond 1000 establishments, migrate to Elasticsearch for hybrid text + geospatial + attribute search. Keep PostgreSQL as source of truth with sync mechanism.

**GraphQL Layer**: Allow mobile clients to request exactly needed fields in single query, potentially reducing data transfer by 30-40%. Adds backend complexity, implement only after clear data on field usage patterns.

**Push Notifications**: Partner engagement with notifications for new reviews and milestones. User retention with personalized notifications about new restaurants matching preferences. Requires device token management infrastructure.

**AI Review Moderation**: Automatically flag reviews likely violating guidelines for priority human review. Requires training data and ongoing tuning, inappropriate for MVP but valuable for scaling beyond 100 reviews/day.

---

**Document Version**: 2.0  
**Last Updated**: September 30, 2025  
**Next Review**: After implementation validation with real traffic patterns