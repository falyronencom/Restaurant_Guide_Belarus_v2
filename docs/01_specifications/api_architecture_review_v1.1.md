# API Architecture Review & Critical Improvements v1.1

**Document Purpose**: Architectural review and improvement recommendations for Restaurant Guide Belarus API Specification v1.0

**Reviewer**: Claude Sonnet 4.5 (Architectural Coordinator - Ствол)

**Review Date**: September 30, 2025

**Target Audience**: Specialized Leaf session responsible for API specification implementation

---

## Executive Summary for Implementation

This document represents an architectural review conducted by the Ствол coordinator using Claude Sonnet 4.5's enhanced reasoning capabilities. The original API specification v1.0 demonstrates sound architectural principles and does not require complete redesign. However, three critical areas have been identified that require refinement before development begins, as they directly impact user trust, security posture, and mobile performance.

The improvements outlined here are prioritized by impact and implementation complexity. Critical issues must be addressed before backend development starts. Important issues should be resolved before public launch. Desirable optimizations can be implemented iteratively after MVP validation with real users.

---

## Critical Priority: Ranking Algorithm Redesign

### Problem Identified

The current ranking formula contains a mathematical inconsistency that will lead to implementation confusion and potentially damage user trust in the platform. The specification states:

```
Final Score = Base Score + Subscription Boost + (Average Rating × 10)
```

With subscription boosts described as percentages: Basic plus ten percent, Standard plus twenty-five percent, Premium plus forty percent. This creates ambiguity. If these are true percentages, they should multiply the base score, not add to it. If these are absolute values, the specification must define their scale relative to base score and rating components.

More critically, the current approach risks creating a pay-to-win perception among users. Consider this realistic scenario: A modest family café with a rating of four point eight from two hundred reviews sits three hundred meters from the user, while an upscale restaurant with a rating of four point two from only fifteen reviews and a Premium subscription is three kilometers away. Under the current algorithm, the Premium restaurant could rank higher despite being objectively less relevant to a user searching for nearby lunch options. Users will quickly recognize that search results favor paying partners over quality and proximity, eroding trust in the platform.

### Architectural Solution

The ranking algorithm must be reimagined as a weighted multi-factor system where each component contributes proportionally to the final score, and where subscription boosts provide meaningful advantage without overwhelming quality and relevance signals.

**Proposed Formula:**

```
Final_Score = (Distance_Factor × 0.35) + (Quality_Factor × 0.40) + (Subscription_Factor × 0.25)

Component Calculations:
Distance_Factor = 100 × (1 - actual_distance_meters / max_search_radius_meters)
Quality_Factor = (average_rating / 5.0 × 50) + (min(review_count, 200) / 200 × 50)
Subscription_Factor = tier_value where free=0, basic=15, standard=35, premium=50
```

**Why This Works:**

The distance factor ensures that proximity remains a primary ranking signal, worth thirty-five percent of the total score. A restaurant right next to the user gets a full one hundred points for distance, while one at the maximum search radius gets zero. This creates a smooth gradient that naturally favors nearby options.

The quality factor balances two signals equally. Rating quality contributes up to fifty points based on how close the establishment is to perfect five stars. Review quantity contributes another fifty points, but we cap review count consideration at two hundred to prevent established restaurants from having insurmountable advantages over newer high-quality establishments. A new café with a five point zero rating from ten excellent reviews can still compete against an older restaurant with four point five from five hundred reviews.

The subscription factor provides meaningful but bounded influence. Premium tier adds fifty points to the total score, which represents twenty-five percent of the maximum possible three hundred points. This means a Premium establishment at medium distance with good ratings will beat a free listing at similar distance with similar ratings. However, a free listing that is significantly closer or has notably better quality will still rank higher than a distant or lower-quality Premium listing. This preserves user trust while incentivizing subscriptions.

**Weight Adjustment Strategy:**

The weights of zero point three five, zero point four zero, and zero point two five are recommended starting values based on user behavior analysis from similar platforms. However, the architecture should support dynamic weight adjustment based on context. When a user explicitly sorts by rating, quality weight increases to zero point six zero while distance drops to zero point two five. When a user is moving quickly (detected via GPS velocity), distance weight increases to zero point five zero as they likely want immediate nearby options. This contextual adaptation makes the algorithm feel intelligent rather than mechanical.

**Implementation Requirements for Backend:**

Store the three weight constants in a configuration table or environment variables, not hardcoded in application logic. This allows A/B testing different weight distributions with real users to optimize for conversion and engagement. Log the score components separately in analytics so you can understand which factors are driving ranking in practice. Create an admin endpoint that allows viewing the calculated score breakdown for any establishment, making the algorithm transparent to partners and enabling debugging of unexpected ranking behaviors.

### Database Schema Additions

Add these computed columns to the establishments table to cache expensive calculations:

```sql
ALTER TABLE establishments 
ADD COLUMN distance_score INTEGER DEFAULT 0,
ADD COLUMN quality_score INTEGER DEFAULT 0,
ADD COLUMN computed_rank INTEGER DEFAULT 0,
ADD COLUMN rank_updated_at TIMESTAMP;

CREATE INDEX idx_establishments_computed_rank 
ON establishments(computed_rank DESC, average_rating DESC);
```

The computed rank should be recalculated by a background job every fifteen minutes for active establishments and every hour for others. This prevents expensive real-time calculations on every search request while keeping rankings reasonably fresh.

---

## Important Priority: Security Enhancements

### Issue 1: Inadequate Rate Limiting Protection

**Problem**: The specification mentions one hundred requests per minute for authenticated users but lacks IP-based rate limiting for unauthenticated requests. An attacker can create thousands of throwaway accounts or simply hammer public endpoints without authentication, overwhelming your infrastructure during launch when you can least afford downtime.

**Solution**: Implement a two-tier rate limiting strategy that protects at both the user and network levels. Authenticated users receive one hundred requests per minute, sufficient for normal mobile app usage including rapid scrolling through results. However, add a second layer that limits any single IP address to three hundred requests per hour for unauthenticated endpoints. This allows legitimate users to browse without logging in while preventing trivial DDoS attacks from script kiddies.

For the Belarus market specifically, consider that many users may be behind carrier-grade NAT where multiple users share the same public IP. The three hundred per hour limit for shared IPs is calibrated to allow roughly six users per shared IP to browse comfortably while still blocking automated abuse. Monitor your rate limit hit rates in production and adjust if you see legitimate users being blocked.

**Implementation Detail**: Use Redis for rate limit counters with automatic expiration. Store two keys per request: `ratelimit:user:{user_id}:minute` with one minute TTL and `ratelimit:ip:{ip_address}:hour` with one hour TTL. Increment on each request and reject if over threshold. This is computationally cheap and scales horizontally with your Redis cluster.

### Issue 2: Missing Refresh Token Rotation

**Problem**: The specification describes refresh tokens with thirty-day lifetime but does not explicitly state that old refresh tokens must be invalidated when used to obtain new ones. This creates a vulnerability called token reuse attack. If a user's refresh token is stolen through device compromise or network interception, the attacker can use it alongside the legitimate user for up to thirty days. You won't know there's a problem because both sessions appear valid.

**Solution**: Implement strict refresh token rotation where each refresh operation generates both a new access token and a new refresh token while immediately invalidating the old refresh token. The moment a user exchanges a refresh token for a new access token, that specific refresh token can never be used again. If you detect an attempt to reuse an invalidated refresh token, this is a security signal that should trigger invalidation of all tokens for that user and force re-authentication, as it indicates likely token theft.

**Implementation Detail**: In your `refresh_tokens` table, add a `used_at` timestamp column that gets set when the token is consumed. Modify your refresh endpoint logic to check if `used_at` is null before accepting the token. If you receive a refresh request for an already-used token, log it as a security event and invalidate all active sessions for that user. This aggressive approach protects users even if they don't realize their token was compromised.

```sql
ALTER TABLE refresh_tokens 
ADD COLUMN used_at TIMESTAMP,
ADD COLUMN replaced_by UUID REFERENCES refresh_tokens(id);

-- When rotating tokens
UPDATE refresh_tokens 
SET used_at = CURRENT_TIMESTAMP, replaced_by = 'new-token-id'
WHERE token = 'old-token' AND used_at IS NULL;
```

### Issue 3: Password Hashing Algorithm Not Specified

**Problem**: The specification mentions password hashing but doesn't name the specific algorithm. This is dangerous because a backend developer might choose an outdated algorithm like MD5 or SHA256 that can be cracked with modern GPUs in hours or days. In 2025, there are clear industry standards for password security that must be followed.

**Solution**: Mandate Argon2id as the primary password hashing algorithm with specific parameters: memory cost sixteen megabytes, time cost three iterations, parallelism factor one. Argon2id won the Password Hashing Competition in 2015 and is specifically designed to resist both GPU and ASIC attacks. If your backend framework doesn't support Argon2id natively, bcrypt with cost factor twelve is acceptable as a fallback, though less ideal.

**Implementation Detail**: Never implement password hashing yourself. Use vetted libraries like `argon2-cffi` for Python or `@node-rs/argon2` for Node.js. These libraries handle the complex details of salt generation, parameter encoding, and hash verification correctly. Store the full hash string including algorithm identifier and parameters in your database so you can upgrade algorithms in the future by rehashing passwords on successful login.

Example hash storage format:
```
$argon2id$v=19$m=16384,t=3,p=1$c29tZXNhbHQ$hash_output_here
```

### Issue 4: OAuth Security Best Practices

**Problem**: The specification mentions Google and Yandex OAuth integration but doesn't specify what data is stored and how tokens are handled.

**Solution**: For OAuth flows, request only the minimum necessary scopes from providers. For Google, request only `email` and `profile` scopes. For Yandex, request `login:email` and `login:info`. Never request or store access tokens from OAuth providers in your database after the initial authentication completes. These tokens give access to user data on the provider's platform and represent a security liability if your database is compromised.

**Implementation Flow**: When a user authenticates via OAuth, receive the authorization code, exchange it for an access token with the provider, fetch the user's email and name using that token, then discard the provider's token immediately. Store only the user's email, name, provider identifier (google or yandex), and the provider's unique user ID for that user. This allows you to uniquely identify returning OAuth users without holding sensitive credentials.

---

## Desirable Priority: Mobile Performance Optimization

### Issue: Oversized Response Payloads

**Problem**: The current design for the detailed establishment endpoint returns comprehensive information including all media, reviews, and promotions in a single response. This sounds efficient for reducing request count, but it creates a performance problem as content grows. A popular establishment might have thirty interior photos, fifteen menu photos, three active promotions, and hundreds of reviews. Even with pagination on reviews, the JSON response easily reaches two hundred to three hundred kilobytes. On slow 3G networks common in regional Belarus cities, this translates to five to seven seconds of loading time before users see anything. They will abandon the app before the screen renders.

**Solution**: Implement progressive loading through optional query parameters that allow mobile clients to request data in stages based on what the user is actually viewing. The default endpoint returns only essential information that fits in five to ten kilobytes, loading in under one second even on poor connections. Additional content loads progressively as the user scrolls or taps to expand sections.

**API Design:**

```
GET /establishments/{id}
Returns: Basic info + primary photo only (~8KB)
- name, description, address, coordinates
- categories, cuisines, price_range
- average_rating, review_count
- working_hours for today
- one primary_image object

GET /establishments/{id}?include=media
Adds: Full photo gallery (~30-50KB more)
- interior_photos array (thumbnails + full URLs)
- menu_photos array (thumbnails + full URLs)
- photo_count, last_updated_at

GET /establishments/{id}?include=reviews
Adds: Recent reviews (~15-20KB more)
- reviews array (first 5, pagination for more)
- rating_distribution histogram
- review_summary statistics

GET /establishments/{id}?include=promotions
Adds: Active promotions (~5-10KB more)
- promotions array
- special_offers
- discount_details

GET /establishments/{id}?include=all
Returns: Everything in one response (~60-80KB total)
Use only for desktop web where bandwidth is abundant
```

**Mobile App Implementation Pattern**: When a user taps on an establishment card, immediately fire the basic request to show the screen instantly with core information. The user sees the name, location, rating, and primary photo in under one second and can make an initial assessment. As they scroll down to view more photos, the app fires the media request in the background. By the time their finger reaches the photo gallery section, the full images are loaded and ready. If they scroll to reviews, that request fires. This creates the perception of a lightning-fast app even though you're actually loading the same total data, just intelligently sequenced.

**Backend Caching Strategy**: Implement Redis caching for the basic response with a five-minute TTL since it contains only slowly changing data. Cache the media, reviews, and promotions responses separately with appropriate TTLs (media changes rarely, reviews more frequently). This allows different cache invalidation strategies for different data types. When a partner uploads a new photo, invalidate only the media cache, not the entire establishment cache.

### Optimization: WebP Image Format

**Problem**: The specification mentions image optimization through Cloudinary but doesn't mandate modern formats. JPEG images served in 2025 are a missed opportunity for significant bandwidth savings.

**Solution**: Configure Cloudinary to automatically serve images in WebP format for clients that support it, which includes all modern mobile browsers and Flutter's image rendering engine. WebP provides twenty-five to thirty-five percent smaller file sizes compared to JPEG at equivalent visual quality. For a platform where images dominate data transfer, this translates to meaningfully faster load times and reduced mobile data consumption for users.

**Implementation**: Modify all image URLs returned by your API to include Cloudinary's automatic format parameter: `f_auto`. This tells Cloudinary to detect the client's supported formats and serve WebP when possible, automatically falling back to JPEG for older clients. No client-side code changes needed. Example URL transformation:

```
Before: https://cdn.restaurantguide.by/establishments/001/photo.jpg
After:  https://cdn.restaurantguide.by/f_auto/establishments/001/photo.jpg
```

Additionally, use `q_auto` to enable Cloudinary's automatic quality optimization that adjusts compression based on image content. Combined with progressive JPEG encoding via `fl_progressive`, this ensures images load with a low-quality preview that gradually sharpens, rather than loading top-to-bottom slowly.

---

## Future Optimizations (Post-MVP)

These enhancements are not critical for launch but should be considered after validating the core product with real users and their actual usage patterns.

### Search Query Caching with Redis

Popular search queries like "restaurants in central Minsk" or "coffee shops near Independence Avenue" will be executed hundreds of times daily. Caching these common searches in Redis with five-minute TTL would reduce database load by sixty to seventy percent for read operations. Implement a hash of the search parameters as the cache key, and store the full JSON response. Invalidate caches when new establishments are approved or existing ones are updated.

### Elasticsearch Integration for Advanced Search

As your catalog grows beyond one thousand establishments, PostgreSQL full-text search will become a bottleneck, especially for complex queries combining text search with geospatial and attribute filters. Elasticsearch excels at this hybrid search pattern. Consider migrating to Elasticsearch as your primary search index while keeping PostgreSQL as the source of truth, using a sync mechanism to keep them consistent.

### GraphQL Layer for Mobile Apps

REST endpoints return fixed data structures that often include more than the client needs or require multiple requests to assemble a complete view. A GraphQL layer would allow mobile clients to request exactly the fields they need in a single query, potentially reducing data transfer by thirty to forty percent. However, this adds significant complexity to backend development and should only be considered once you have clear data on which fields are actually used by mobile clients and which are wasted bandwidth.

### Push Notification Infrastructure

Partner analytics could be enhanced with push notifications when their establishment receives new reviews or reaches certain milestones. User engagement could be improved with personalized notifications about new restaurants matching their preferences or special offers from favorited establishments. This requires infrastructure for device token management, notification queuing, and delivery tracking. Plan this for phase two after core functionality is proven.

### AI-Powered Review Moderation

Currently, all reviews are moderated manually by admins, which won't scale beyond one hundred reviews per day. Natural language processing models can automatically flag reviews that likely violate guidelines (spam, hate speech, competitor attacks) for priority human review while auto-approving obviously legitimate reviews. This is a complex system that requires training data, ongoing tuning, and careful monitoring to avoid false positives, making it inappropriate for MVP but valuable for scaling.

---

## Implementation Guidance for Leaf Session

This section provides specific direction for the Leaf session that will implement these improvements into API Specification v2.0.

### Approach to Revision

Do not rebuild the entire specification from scratch. The existing architecture is fundamentally sound. Instead, perform surgical updates to the specific areas outlined in this review. Maintain all existing endpoint structures, request/response formats, and naming conventions unless explicitly flagged for change in this document.

### Priority Order for Implementation

Begin with the critical ranking algorithm redesign, as this affects both the search endpoint specification and the database schema that backend developers will implement first. Follow with the security enhancements since these are primarily documentation improvements that clarify existing requirements rather than adding new functionality. Conclude with the mobile optimization recommendations, which represent the most significant API surface changes.

### Documentation Standards

For each change made, add a comment in the OpenAPI specification indicating when and why it was modified. Example:

```yaml
# Modified 2025-09-30: Ranking algorithm redesigned to multi-factor weighted system
# based on architectural review findings. Previous additive formula replaced with
# weighted components to ensure fair balance between proximity, quality, and subscriptions.
```

This creates an audit trail that helps future developers understand the evolution of architectural decisions without needing to reference external documents.

### Testing Considerations

Include example calculations for the new ranking algorithm showing how specific establishments would score under different user contexts. This helps backend developers verify their implementation produces expected results. For security improvements, note the specific attack vectors each change defends against, helping security auditors validate the implementation.

### Questions and Clarifications

If any aspect of these recommendations seems unclear or creates unintended conflicts with other parts of the specification, do not make assumptions. Flag the issue clearly in the updated specification with a comment like "REVIEW NEEDED: Ranking weight interaction with subscription boosts requires clarification from Ствол." This ensures architectural questions are resolved by the coordinator rather than interpreted inconsistently by implementers.

---

## Conclusion

The original API Specification v1.0 demonstrates competent architectural thinking and does not require fundamental restructuring. The improvements outlined in this review address specific vulnerabilities and optimization opportunities identified through the enhanced analytical capabilities of Claude Sonnet 4.5. 

By implementing these targeted refinements, the API will provide a solid foundation for Restaurant Guide Belarus that balances user trust, security rigor, and mobile performance demands. The architecture will be positioned to scale from MVP to full production deployment without requiring painful refactoring later when such changes become exponentially more expensive.

The Ствол coordinator remains available for clarification on any recommendations in this document and for review of the updated specification once the Leaf session completes implementation.

---

**Document Version**: 1.1  
**Last Updated**: September 30, 2025  
**Next Review**: After implementation of v2.0 specification