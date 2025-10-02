# Project Sync Memo: API v2 Coordination

## Назначение

Данный документ фиксирует ключевые решения, договоренности и синхронизацию между командами разработки по API v2 для Restaurant Guide Belarus.

## Основные задачи
- Обеспечить согласованность между backend, mobile и admin-web
- Зафиксировать изменения, влияющие на интеграцию
- Описать workflow для обновления и тестирования API

## Ключевые договоренности
- Все изменения в API v2 фиксируются в этом документе и в спецификации `docs/02_architecture/api_specification_v2.0.yaml`
- Для новых эндпоинтов требуется предварительное согласование между командами
- Используется REST архитектура, JWT для авторизации, стандартные коды ошибок

## Workflow синхронизации
1. Предложение изменений — через Pull Request и обсуждение в этом документе
2. Обновление спецификации — после согласования
3. Тестирование интеграции — mobile, admin-web, backend
4. Документирование изменений

## Контакты и ответственные
- Архитектурный координатор: @falyronencom
- Backend: @backend-team
- Mobile: @mobile-team
- Admin Web: @admin-web-team

## История изменений
- 2025-10-02: Создан базовый шаблон документа

---

> Для всех вопросов по синхронизации API используйте этот документ и Issues на GitHub.





# API Specification v2.0 - Executive Summary & Implementation Guide

**Project**: Restaurant Guide Belarus  
**Document Type**: Implementation Summary for Backend Team  
**Date**: September 30, 2025  
**Status**: Ready for Implementation

---

## What Changed and Why

This document summarizes the transition from API Specification v1.0 to v2.0, explaining what changed, why it matters, and how to implement the improvements. The architectural review identified three areas requiring immediate attention before development begins: ranking fairness, security vulnerabilities, and mobile performance. These are not theoretical concerns but practical issues that would create technical debt and user trust problems if left unaddressed.

---

## Critical Priority Changes

### 1. Ranking Algorithm Redesign

**The Problem We're Solving**

The original ranking formula used simple addition of base score, subscription boost percentage, and rating multiplier. This created mathematical ambiguity about whether percentages multiply or add, but more critically, it risked creating a pay-to-win dynamic where establishments with Premium subscriptions could dominate results regardless of quality or relevance. Imagine searching for coffee near you and seeing a Premium-tier restaurant three kilometers away ranked above an excellent free café fifty meters away. Users would quickly lose trust in search results, perceiving them as advertisements rather than helpful recommendations.

**The Solution**

We redesigned ranking as a weighted multi-factor system where each component contributes proportionally to a final score out of three hundred points. The formula balances three factors: distance from user (thirty-five percent weight), establishment quality combining rating and review quantity (forty percent weight), and subscription tier (twenty-five percent weight). This ensures that proximity and quality remain dominant ranking signals worth seventy-five percent combined, while paid subscriptions provide meaningful but bounded influence.

The key insight is that a Premium subscription worth fifty points cannot overcome an establishment that is significantly closer or notably higher quality. A five-star café with two hundred reviews at five hundred meters will beat a three-star restaurant with fifteen reviews at three kilometers even if the latter has Premium and the former is free. This preserves user trust while incentivizing subscriptions.

**Implementation Requirements**

Add four computed columns to the establishments table: distance_score, quality_score, computed_rank, and rank_updated_at. These cache expensive ranking calculations performed by a background job running every fifteen minutes for active establishments. The search endpoint reads these pre-computed values rather than calculating rankings real-time, enabling sub-one-hundred-millisecond response times even with thousands of establishments.

Create the `/establishments/{id}/ranking` endpoint that returns detailed score breakdowns showing how each factor contributed to final ranking. This transparency endpoint is available to partners viewing their own listings and admins, helping partners understand subscription value and identify improvement areas. The endpoint becomes a sales tool demonstrating exactly how much visibility boost each subscription tier provides.

**Testing Validation**

Create fixture establishments with known characteristics and verify ranking calculations produce expected results. For example, establish that Establishment A at five hundred meters with rating four point eight from two hundred reviews and Premium tier ranks higher than Establishment B at three thousand meters with rating four point two from fifteen reviews and Free tier. These test cases validate that proximity and quality factors appropriately outweigh subscription tier, preventing pay-to-win perception.

---

### 2. Security Enhancements

**2.1 Rate Limiting Protection**

**The Problem We're Solving**

The original specification mentioned rate limiting for authenticated users but lacked protection for unauthenticated endpoints. An attacker could create thousands of throwaway accounts or simply hammer public endpoints without authentication, overwhelming infrastructure during launch when you can least afford downtime. Script kiddies running simple Python loops could take down your API without sophisticated attack techniques.

**The Solution**

Implement two-tier rate limiting protecting at both user and network levels. Authenticated users receive one hundred requests per minute, sufficient for normal mobile app usage including rapid scrolling through results. Add a second layer limiting any single IP address to three hundred requests per hour for unauthenticated endpoints. This allows legitimate users to browse without logging in while preventing trivial denial-of-service attacks.

The three hundred per hour limit for shared IPs is calibrated for the Belarus market where many users are behind carrier-grade NAT sharing public IP addresses. This limit allows approximately six users per shared IP to browse comfortably while still blocking automated abuse. Monitor rate limit hit rates in production and adjust if you see legitimate users being blocked.

**Implementation Details**

Use Redis for rate limit counters with automatic expiration. Store two keys per request: `ratelimit:user:{user_id}:minute` with one-minute time-to-live and `ratelimit:ip:{ip_address}:hour` with one-hour time-to-live. Increment on each request and reject if over threshold. This is computationally cheap and scales horizontally with your Redis cluster.

When rate limit is exceeded, return structured error response including the limit threshold, time window, seconds until reset, and exact reset timestamp. This allows mobile clients to show user-friendly messages like "Too many requests, please wait two minutes" rather than generic error screens that cause confusion and frustration.

**2.2 Refresh Token Rotation**

**The Problem We're Solving**

The original specification described refresh tokens with thirty-day lifetime but did not explicitly state that old refresh tokens must be invalidated when used. This creates a vulnerability called token reuse attack. If a user's refresh token is stolen through device compromise or network interception, the attacker can use it alongside the legitimate user for up to thirty days without detection. You won't know there's a security problem because both sessions appear valid in your system.

**The Solution**

Implement strict refresh token rotation where each refresh operation generates both a new access token and a new refresh token while immediately invalidating the old refresh token. The moment a user exchanges a refresh token for a new access token, that specific refresh token can never be used again. Add used_at timestamp column and replaced_by foreign key to refresh_tokens table tracking token consumption.

If you detect an attempt to reuse an invalidated refresh token (used_at is not null), this is a security signal indicating likely token theft. The aggressive response is to immediately invalidate all active sessions for that user and force re-authentication. This protects users even if they don't realize their token was compromised.

**Implementation Details**

Modify your refresh endpoint logic to check if used_at is null before accepting the token. When successfully refreshing, set used_at to current timestamp and replaced_by to the new token's ID. Log token reuse attempts as security events with IP address, user agent, and attempted token hash. Set up monitoring alerts for these security events as they indicate active attacks or compromised devices.

Mobile clients must store both access and refresh tokens securely and replace old refresh token with new one immediately upon successful refresh. Failure to update stored refresh token will result in authentication failure on next refresh attempt, but this is acceptable because it forces user to log in again with credentials, which is the secure fallback behavior.

**2.3 Password Hashing Specification**

**The Problem We're Solving**

The original specification mentioned password hashing but didn't name the specific algorithm. This is dangerous because a backend developer might choose an outdated algorithm like MD5 or SHA256 that can be cracked with modern GPUs in hours or days. Even with proper salting, these algorithms were not designed for password hashing and lack memory hardness that resists parallel attacks.

**The Solution**

Mandate Argon2id as the primary password hashing algorithm with specific parameters: memory cost sixteen megabytes, time cost three iterations, parallelism factor one. Argon2id won the Password Hashing Competition in 2015 and is specifically designed to resist both GPU and ASIC attacks through memory-hard construction. If your backend framework doesn't support Argon2id natively, bcrypt with cost factor twelve is acceptable as fallback, though less ideal.

**Implementation Details**

Never implement password hashing yourself. Use vetted libraries like argon2-cffi for Python or @node-rs/argon2 for Node.js. These libraries handle the complex details of salt generation, parameter encoding, and hash verification correctly. Store the full hash string including algorithm identifier and parameters in your database so you can upgrade algorithms in the future by rehashing passwords on successful login.

The hash storage format looks like: `$argon2id$v=19$m=16384,t=3,p=1$c29tZXNhbHQ$hash_output_here`. This self-describing format allows the verification function to automatically use the correct algorithm and parameters, enabling graceful algorithm upgrades without breaking existing user accounts.

**2.4 OAuth Security Best Practices**

**The Problem We're Solving**

The original specification mentioned Google and Yandex OAuth integration but didn't specify what data is stored and how tokens are handled. OAuth access tokens from providers grant access to user data on those platforms. If these tokens are stored in your database and your database is compromised, attackers gain access not just to your platform but to users' Google or Yandex accounts, creating liability far exceeding your own service.

**The Solution**

For OAuth flows, request only minimum necessary scopes from providers. For Google, request only `email` and `profile` scopes. For Yandex, request `login:email` and `login:info`. Never request or store access tokens from OAuth providers in your database after initial authentication completes.

When a user authenticates via OAuth, receive the authorization code, exchange it for an access token with the provider, fetch the user's email and name using that token, then discard the provider's token immediately. Store only the user's email, name, provider identifier (google or yandex), and the provider's unique user ID for that user. This allows you to uniquely identify returning OAuth users without holding sensitive credentials that could be misused if your database is breached.

---

## Important Priority Changes

### 3. Mobile Performance Optimization

**3.1 Progressive Loading Support**

**The Problem We're Solving**

The original design for the detailed establishment endpoint returns comprehensive information including all media, reviews, and promotions in a single response. This sounds efficient for reducing request count, but creates a performance problem as content grows. A popular establishment might have thirty interior photos, fifteen menu photos, three active promotions, and hundreds of reviews. Even with pagination on reviews, the JSON response easily reaches two hundred to three hundred kilobytes.

On slow 3G networks common in regional Belarus cities like Gomel or Mogilev, this translates to five to seven seconds of loading time before users see anything on their screen. They will abandon the app before the screen renders, perceiving it as broken or unresponsive. You lose users not because your content is bad but because they never see it.

**The Solution**

Implement progressive loading through optional query parameters that allow mobile clients to request data in stages based on what the user is actually viewing. The default endpoint returns only essential information fitting in eight to ten kilobytes, loading in under one second even on poor connections. Additional content loads progressively as the user scrolls or taps to expand sections.

When user taps on establishment card, immediately fire the basic request without include parameter. They see the screen instantly with name, location, rating, primary photo, and today's hours. The user can make initial assessment if this is what they're looking for. As they scroll down to view more photos, the app fires `include=media` request in background. By the time their finger reaches photo gallery section, full images are loaded and ready. If they scroll to reviews, that request fires. This creates perception of lightning-fast app even though you're loading the same total data, just intelligently sequenced.

**Implementation Details**

Modify the establishments detail endpoint to check for optional include query parameter. Without include parameter, return EstablishmentMinimal schema containing only essential fields. With `include=media`, add full media array. With `include=reviews`, add recent_reviews array. With `include=promotions`, add active_promotions array. With `include=all`, return the full EstablishmentDetailed schema for desktop web where bandwidth is abundant.

Implement separate caching strategies for each include option using Redis. The minimal response contains slowly changing data, cache with five-minute time-to-live. Media changes infrequently, cache with fifteen-minute time-to-live. Reviews are more dynamic, cache with two-minute time-to-live. This allows different cache invalidation strategies for different data types. When partner uploads new photo, invalidate only media cache, not entire establishment cache.

**3.2 WebP Image Format**

**The Problem We're Solving**

The original specification mentions image optimization through Cloudinary but doesn't mandate modern formats. JPEG images served in 2025 are a missed opportunity for significant bandwidth savings. WebP format provides twenty-five to thirty-five percent smaller file sizes compared to JPEG at equivalent visual quality. For a platform where images dominate data transfer, this translates to meaningfully faster load times and reduced mobile data consumption for users.

**The Solution**

Configure Cloudinary to automatically serve images in WebP format for clients that support it, which includes all modern mobile browsers and Flutter's image rendering engine. Modify all image URLs returned by your API to include Cloudinary's automatic format parameter: `f_auto`. This tells Cloudinary to detect the client's supported formats and serve WebP when possible, automatically falling back to JPEG for older clients. No client-side code changes needed.

Additionally use `q_auto` to enable Cloudinary's automatic quality optimization that adjusts compression based on image content. Combined with `fl_progressive` for progressive JPEG encoding, this ensures images load with low-quality preview that gradually sharpens rather than loading top-to-bottom slowly. This creates perception of faster loading even on identical network speeds.

**Implementation Details**

Update your media upload endpoint to construct Cloudinary URLs with optimization parameters. Example transformation: `https://cdn.restaurantguide.by/f_auto,q_auto,fl_progressive/establishments/001/photo.jpg`. The Cloudinary CDN handles format negotiation automatically based on Accept headers from client. Your backend just constructs URLs with correct parameters, Cloudinary handles the complexity of format selection and conversion.

For the three-tier resolution system (thumbnail 200x150, preview 800x600, original 1920x1080), apply the same optimization parameters to each resolution. This ensures consistent format delivery across all image sizes. Monitor your Cloudinary bandwidth usage and format distribution to verify WebP adoption rate and bandwidth savings.

---

## Implementation Roadmap

### Week 1-2: Security Foundation

**Priority**: Critical - Must be correct from day one

Implement authentication system with Argon2id password hashing and strict refresh token rotation. This foundation must be secure from launch because retrofit would require password reset for all users, creating terrible user experience. Set up Redis infrastructure for rate limiting with proper monitoring of hit rates to detect both attacks and legitimate traffic patterns.

**Deliverables**:
- Authentication endpoints with Argon2id hashing
- Refresh token rotation with token reuse detection
- Two-tier rate limiting (user + IP based)
- OAuth endpoints with minimal data storage
- Security event logging for token reuse attempts

**Testing**:
- Verify Argon2id parameters using official test vectors
- Test refresh token rotation by attempting reuse
- Validate rate limiting with concurrent request bombardment
- Confirm OAuth tokens never appear in database or logs

### Week 2-3: Ranking Algorithm

**Priority**: Critical - Affects user trust and business model

Implement multi-factor weighted ranking system with background job for score computation. Add comprehensive logging of score components to validate algorithm behavior matches specification. Create the ranking transparency endpoint allowing partners and admins to view detailed score breakdowns.

**Deliverables**:
- Database migrations for computed ranking columns
- Background job computing scores every 15 minutes
- Search endpoint using pre-computed rankings
- Ranking breakdown transparency endpoint
- Weight adaptation based on sort preference

**Testing**:
- Create fixture establishments with known characteristics
- Verify ranking calculations match expected results
- Test weight adaptation with different sort preferences
- Validate that proximity and quality dominate over subscriptions

### Week 3-4: Progressive Loading & Images

**Priority**: Important - Significantly improves user experience

Implement staged endpoint responses with optional include parameters. Configure Cloudinary with optimization parameters for all image URLs. Test thoroughly with mobile clients on simulated 3G networks to verify performance improvements meet specifications.

**Deliverables**:
- Modified establishments detail endpoint with include parameter
- Separate response schemas for minimal/detailed data
- Granular caching strategy per include option
- Cloudinary URL construction with f_auto, q_auto, fl_progressive
- Cache invalidation logic by data type

**Testing**:
- Measure response payload sizes match specifications (±10%)
- Test loading sequence on simulated slow networks
- Verify WebP format delivered to modern clients
- Confirm progressive JPEG rendering behavior

### Week 4-5: Integration & Validation

**Priority**: Essential - Ensures all pieces work together

Full integration testing of all components with realistic data volumes and network conditions. Performance testing under load to validate sub-one-hundred-millisecond search response times. Security testing to confirm no vulnerabilities in authentication or authorization flows.

**Deliverables**:
- End-to-end integration tests for all critical paths
- Load testing with 1000+ establishments
- Security penetration testing of authentication
- Performance profiling of ranking calculations
- Documentation for mobile app integration

**Testing**:
- Search with 1000+ establishments stays under 200ms p95
- Ranking job completes in under 30 seconds
- No security vulnerabilities found in auth flows
- Progressive loading improves perceived performance by 60%+

---

## Database Migration Checklist

Execute migrations in this order to minimize downtime and risk:

**Migration 1: Refresh Token Security**
```sql
ALTER TABLE refresh_tokens 
ADD COLUMN used_at TIMESTAMP,
ADD COLUMN replaced_by UUID REFERENCES refresh_tokens(id);
```
Zero downtime. Add columns before deploying new auth logic.

**Migration 2: Ranking Score Columns**
```sql
ALTER TABLE establishments 
ADD COLUMN distance_score INTEGER DEFAULT 0,
ADD COLUMN quality_score INTEGER DEFAULT 0,
ADD COLUMN computed_rank INTEGER DEFAULT 0,
ADD COLUMN rank_updated_at TIMESTAMP;
```
Zero downtime. Add columns before deploying ranking algorithm.

**Migration 3: Ranking Index**
```sql
CREATE INDEX CONCURRENTLY idx_establishments_computed_rank 
ON establishments(computed_rank DESC, average_rating DESC);
```
May cause brief query slowdown during creation. Use CONCURRENTLY to avoid table locks. Run during low-traffic hours.

**Migration 4: Background Job Deployment**
Deploy ranking computation job after columns and index exist. Job populates computed_rank for existing establishments before search endpoint goes live.

**Migration 5: API Deployment**
Deploy updated API with new endpoints and modified responses. Backward compatible with v1.0 clients.

---

## Monitoring & Alerting Setup

### Critical Alerts (Immediate Response Required)

**Token Reuse Detected**
- Trigger: Attempt to use already-consumed refresh token
- Action: Security incident investigation
- Response Time: Immediate

**Search Response Time >500ms**
- Trigger: p95 latency exceeds 500ms for 5 minutes
- Action: Performance degradation investigation
- Response Time: Within 15 minutes

**Ranking Job Failures**
- Trigger: Background ranking job fails or times out
- Action: Data inconsistency investigation
- Response Time: Within 30 minutes

### Warning Alerts (Review Within Hours)

**Rate Limit Hits >50% Legitimate IPs**
- May indicate limits too aggressive
- Consider adjustment based on traffic patterns

**Image Load Times >3 seconds**
- Check Cloudinary CDN performance
- Verify optimization parameters applied

**OAuth Authentication Failures >10%**
- Check provider API status
- Verify token exchange logic

### Metrics to Track

**Authentication**:
- Login success/failure rate
- Refresh token rotation frequency
- Token reuse attempt count
- OAuth provider distribution

**Search Performance**:
- Search response time (p50, p95, p99)
- Ranking computation job duration
- Cache hit rates per endpoint
- Results returned per search

**Mobile Performance**:
- Response payload sizes by endpoint
- Image format distribution (WebP vs JPEG)
- Progressive loading adoption rate
- Perceived load time from client metrics

**Business Metrics**:
- Search-to-detail view conversion
- Favorite rate per establishment
- Review creation rate
- Subscription tier distribution

---

## Key Differences from v1.0

This table summarizes what changed and why it matters:

| Area | v1.0 Approach | v2.0 Approach | Impact |
|------|---------------|---------------|---------|
| **Ranking** | Additive formula with unclear percentages | Weighted multi-factor with explicit percentages | Prevents pay-to-win, preserves user trust |
| **Token Security** | Refresh tokens valid for full 30 days | Single-use rotation, immediate invalidation | Detects and prevents token theft attacks |
| **Rate Limiting** | Authenticated users only | Two-tier: users + IP-based | Protects against DDoS during launch |
| **Password Hashing** | Algorithm unspecified | Mandatory Argon2id with parameters | Resists modern GPU/ASIC attacks |
| **OAuth Handling** | Not specified | Explicit minimal data storage | Eliminates liability from provider tokens |
| **Detail Loading** | Single response with everything | Progressive loading via include parameter | Reduces initial load from 60KB to 8KB |
| **Image Format** | JPEG only | Automatic WebP with JPEG fallback | Saves 25-35% bandwidth, faster loads |

---

## Common Implementation Questions

**Q: Can we delay the ranking algorithm redesign to post-MVP?**

No. The ranking algorithm directly affects user trust in search results. If users perceive results as pay-to-win rather than relevant, they abandon the platform before you have data to optimize. This must be right from launch.

**Q: Is strict refresh token rotation really necessary? It adds complexity.**

Yes. Token theft is not theoretical - it happens through device compromise, network interception, malware. The additional complexity is minimal (one extra column, one conditional check) while the security improvement is substantial.

**Q: Can we use bcrypt instead of Argon2id? It's more common.**

Bcrypt with cost factor 12 is acceptable fallback if your framework lacks Argon2id support, but Argon2id is specifically designed for modern threat landscape with GPU farms. If both are equally easy to implement, choose Argon2id.

**Q: Do we need progressive loading if our server is fast?**

Yes. The bottleneck is network speed, not server speed. Even if your server responds in 50ms, the 300KB response takes 6 seconds to transfer on 3G networks. Progressive loading addresses the network bottleneck.

**Q: Can we skip WebP and use JPEG for simplicity?**

WebP support through Cloudinary requires only adding three characters (f_auto) to URLs. The implementation complexity is negligible while bandwidth savings are substantial. There's no reason to skip this optimization.

**Q: How do we test the ranking algorithm with limited production data?**

Create fixture establishments with known characteristics in your test database. Write test cases verifying that proximity and quality appropriately outweigh subscription tiers. The algorithm should be deterministic and testable without real user data.

---

## Success Criteria

You'll know the v2.0 implementation is successful when:

**Security Metrics**:
- Zero refresh token reuse attempts succeed
- All passwords stored with Argon2id hashes
- OAuth tokens never appear in database or logs
- Rate limiting blocks >95% of automated attacks

**Performance Metrics**:
- Search response time p95 <200ms with 1000+ establishments
- Initial establishment detail load <1 second on 3G
- WebP format delivered to >80% of mobile clients
- Progressive loading reduces perceived load time by >60%

**User Trust Metrics**:
- Search results feel relevant to proximity and quality
- Partners report understanding subscription value
- No user complaints about pay-to-win search results
- Review creation rate indicates active engagement

**Developer Experience**:
- Backend team can explain ranking algorithm in simple terms
- Security incidents are quickly detected through monitoring
- Performance issues are diagnosed through comprehensive logging
- New features build on solid architectural foundation

---

## Final Notes for Implementation

This specification represents careful architectural thinking about real problems that would emerge in production. The changes are not theoretical improvements but practical solutions to issues that would create technical debt, security vulnerabilities, and user trust problems if left unaddressed.

Every decision in v2.0 balances correctness, performance, and pragmatism. The ranking algorithm provides fair results while incentivizing subscriptions. The security enhancements protect users without adding friction. The mobile optimizations deliver fast experience without backend complexity.

Implement systematically following the roadmap priorities. Test thoroughly against the success criteria. Monitor continuously for issues requiring adjustment. Most importantly, understand not just what changed but why it matters - this understanding enables good judgment when facing implementation decisions not explicitly covered in the specification.

The architectural foundation you build now determines whether the platform scales smoothly or struggles with technical debt. Invest the time to get v2.0 right, and future development will be faster and more reliable.

---

**Document Version**: 2.0 Final  
**Status**: Ready for Implementation  
**Contact**: Ствол (Architectural Coordinator) for clarifications