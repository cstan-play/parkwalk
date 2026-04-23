# API Specification

## Overview

RESTful API with WebSocket support for real-time features. All endpoints use JSON for request/response bodies.

**Base URL:** `https://api.walkinggame.com/api/v1`

**Authentication:** JWT Bearer tokens

## Authentication

### Register

```http
POST /auth/register
Content-Type: application/json

{
  "username": "walker123",
  "email": "walker@example.com",
  "password": "securePassword123",
  "display_name": "John Walker"
}
```

**Response 201:**
```json
{
  "user": {
    "id": "uuid",
    "username": "walker123",
    "email": "walker@example.com",
    "display_name": "John Walker",
    "created_at": "2025-01-15T10:00:00Z"
  },
  "tokens": {
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_in": 900
  }
}
```

**Errors:**
- `400` - Validation error (username taken, invalid email, weak password)
- `429` - Rate limit exceeded

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "walker@example.com",
  "password": "securePassword123"
}
```

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "username": "walker123",
    "email": "walker@example.com",
    "display_name": "John Walker"
  },
  "tokens": {
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_in": 900
  }
}
```

### Refresh Token

```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGc..."
}
```

**Response 200:**
```json
{
  "access_token": "eyJhbGc...",
  "expires_in": 900
}
```

### Logout

```http
POST /auth/logout
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "refresh_token": "eyJhbGc..."
}
```

**Response 204:** No content

## User Endpoints

### Get Current User

```http
GET /users/me
Authorization: Bearer {access_token}
```

**Response 200:**
```json
{
  "id": "uuid",
  "username": "walker123",
  "email": "walker@example.com",
  "display_name": "John Walker",
  "avatar_url": "https://...",
  "created_at": "2025-01-15T10:00:00Z",
  "settings": {
    "notifications_enabled": true,
    "privacy_mode": false,
    "movement_detection_sensitivity": "normal"
  }
}
```

### Update User Profile

```http
PATCH /users/me
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "display_name": "New Name",
  "avatar_url": "https://new-avatar.jpg"
}
```

**Response 200:** Updated user object

### Get User Stats

```http
GET /users/me/stats
Authorization: Bearer {access_token}
```

**Response 200:**
```json
{
  "distance": {
    "total_meters": 125000,
    "daily_meters": 5200,
    "weekly_meters": 32000
  },
  "collections": {
    "total": 234,
    "daily": 12,
    "weekly": 67
  },
  "treasures": {
    "placed": 15,
    "found_by_others": 89
  },
  "time": {
    "total_minutes": 1850,
    "daily_minutes": 45
  },
  "streaks": {
    "current_days": 7,
    "longest_days": 15,
    "last_activity_date": "2025-01-15"
  },
  "scores": {
    "daily": 320,
    "weekly": 1840,
    "all_time": 12450
  }
}
```

### Get User by ID (Public)

```http
GET /users/:userId
Authorization: Bearer {access_token}
```

**Response 200:**
```json
{
  "id": "uuid",
  "username": "walker123",
  "display_name": "John Walker",
  "avatar_url": "https://...",
  "stats": {
    "total_collections": 234,
    "treasures_placed": 15,
    "all_time_score": 12450
  }
}
```

## Game Entity Endpoints

> **Phase 1 (current) vs this document.** Older subsections below use
> illustrative JSON shapes from the original product sketch. The **live**
> contract is implemented under `/api/v1/entities`, uses **camelCase**
> DTOs from `@parkwalk/shared`, and matches the Zod schemas in
> `shared/src/schemas/entity.ts` and `shared/src/schemas/collect.ts`.
> Movement and collect rules are documented in `docs/07-MOVEMENT-DETECTION.md`.

### Get Nearby Entities (implemented)

```http
GET /api/v1/entities/nearby?lat=55.676&lng=12.568&radiusMeters=500&limit=50
Authorization: Bearer {access_token}
```

**Query parameters** (`nearbyQuerySchema`): `lat`, `lng` (required);
`radiusMeters` (optional, default 500, max 5000); `type` (optional entity
type enum); `limit` (optional, default 50, max 200).

**Behavior:** Results are **scoped to the authenticated user**: entities this
user has already collected are **omitted** so the map does not show completed
pick-ups again.

**Response 200:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "collectible",
      "creatorId": null,
      "location": { "latitude": 55.6761, "longitude": 12.5681 },
      "active": true,
      "visibleFrom": "2026-01-01T00:00:00.000Z",
      "visibleUntil": null,
      "config": { "name": "Seed coin", "points": 10 },
      "collectionRadiusMeters": 10,
      "maxCollections": null,
      "currentCollections": 0,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "distanceMeters": 42.3
    }
  ]
}
```

### Get Entity Details

```http
GET /entities/:entityId
Authorization: Bearer {access_token}
```

**Response 200:**
```json
{
  "id": "uuid",
  "type": "treasure",
  "location": {
    "lat": 37.7749,
    "lng": -122.4194
  },
  "config": {
    "name": "Golden Coin",
    "description": "A rare treasure",
    "rarity": "legendary",
    "points": 100
  },
  "creator": {
    "id": "uuid",
    "username": "hider123",
    "display_name": "Treasure Hider"
  },
  "stats": {
    "total_collections": 23,
    "collections_today": 5
  },
  "created_at": "2025-01-10T12:00:00Z",
  "user_collected": false
}
```

### Collect Entity (implemented)

```http
POST /api/v1/entities/collect
Authorization: Bearer {access_token}
Idempotency-Key: {opaque_key}
Content-Type: application/json
```

**Body** (`collectRequestSchema`): `entityId` (UUID), `location` (`latitude`,
`longitude`, optional `accuracy` in meters — **used for uncertainty-aware
distance**), `summary` (`movementSummarySchema`), `samples` (array of
`movementSampleSchema`; **required in practice** — server hard-rejects if
empty/missing), `clientSentAt` (ISO timestamp).

**Response 201:** `collectResponseSchema` — `collection` (id, entityId,
collectedAt, distanceFromEntityMeters, movementValidated) and `rewards`
(pointsEarned, streakDays, dailyScore, allTimeScore).

**Errors (non-exhaustive):**
- `400` `VALIDATION_ERROR` — malformed body or missing `Idempotency-Key`
- `400` `MOVEMENT_INVALID` — failed `validateMovement` (hard reject); body
  may include `reasons` and `flags`
- `400` `OUT_OF_RANGE` — outside uncertainty-aware collection radius
- `409` `ALREADY_COLLECTED` — user already has this entity
- `409` `ENTITY_INACTIVE` / cap reached / not visible
- `429` — rate limit

### Create Treasure

```http
POST /entities/treasure
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "location": {
    "lat": 37.7749,
    "lng": -122.4194
  },
  "config": {
    "name": "My Secret Cache",
    "description": "A treasure for dedicated walkers",
    "rarity": "rare",
    "points": 50,
    "hint": "Near the blue bench"
  },
  "collection_radius_meters": 10,
  "max_collections": null
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "type": "treasure",
  "location": {
    "lat": 37.7749,
    "lng": -122.4194
  },
  "config": {
    "name": "My Secret Cache",
    "description": "A treasure for dedicated walkers",
    "rarity": "rare",
    "points": 50,
    "hint": "Near the blue bench"
  },
  "creator_id": "uuid",
  "created_at": "2025-01-15T14:30:00Z"
}
```

**Errors:**
- `400` - Invalid location or config
- `403` - Insufficient permissions or rate limit

### Update Entity (Creator Only)

```http
PATCH /entities/:entityId
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "config": {
    "description": "Updated description"
  },
  "active": false
}
```

**Response 200:** Updated entity object

**Errors:**
- `403` - Not the creator
- `404` - Entity not found

### Delete Entity (Creator Only)

```http
DELETE /entities/:entityId
Authorization: Bearer {access_token}
```

**Response 204:** No content

**Errors:**
- `403` - Not the creator
- `404` - Entity not found

## Leaderboard Endpoints

### Get Leaderboard

```http
GET /leaderboard/:period?page=1&limit=50
Authorization: Bearer {access_token}
```

**Path Parameters:**
- `period`: `daily`, `weekly`, or `all_time`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50, max: 100)

**Response 200:**
```json
{
  "period": "daily",
  "leaderboard": [
    {
      "rank": 1,
      "user": {
        "id": "uuid",
        "username": "walker123",
        "display_name": "John Walker",
        "avatar_url": "https://..."
      },
      "score": 1250,
      "collections": 45,
      "distance_meters": 12500,
      "rank_change": 2
    }
  ],
  "current_user_rank": {
    "rank": 23,
    "score": 420,
    "rank_change": -3
  },
  "total_users": 1542,
  "page": 1,
  "total_pages": 31
}
```

### Get User Rank

```http
GET /leaderboard/:period/rank
Authorization: Bearer {access_token}
```

**Response 200:**
```json
{
  "period": "daily",
  "rank": 23,
  "score": 420,
  "collections": 13,
  "distance_meters": 5200,
  "rank_change": -3,
  "percentile": 85.2
}
```

## Activity Feed Endpoints

### Get Activity Feed

```http
GET /activities/feed?limit=50&before=timestamp
Authorization: Bearer {access_token}
```

**Query Parameters:**
- `limit` (optional): Number of activities (default: 50, max: 100)
- `before` (optional): Timestamp for pagination (ISO 8601)

**Response 200:**
```json
{
  "activities": [
    {
      "id": "uuid",
      "user": {
        "id": "uuid",
        "username": "walker123",
        "display_name": "John Walker",
        "avatar_url": "https://..."
      },
      "activity_type": "collection",
      "data": {
        "action": "collected",
        "entity_type": "treasure",
        "entity_name": "Golden Coin",
        "points_earned": 100
      },
      "created_at": "2025-01-15T14:30:00Z"
    },
    {
      "id": "uuid",
      "user": {
        "id": "uuid2",
        "username": "hider456"
      },
      "activity_type": "treasure_placed",
      "data": {
        "action": "placed_treasure",
        "treasure_name": "Secret Cache",
        "location_hint": "Near the park"
      },
      "created_at": "2025-01-15T14:25:00Z"
    }
  ],
  "has_more": true,
  "next_cursor": "2025-01-15T14:20:00Z"
}
```

### Get User Activities

```http
GET /activities/user/:userId?limit=50
Authorization: Bearer {access_token}
```

**Response 200:** Same format as activity feed but filtered by user

## Movement Validation Endpoint

### Validate Movement Session

```http
POST /movement/validate
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "session_id": "uuid",
  "duration_seconds": 1800,
  "distance_meters": 2400,
  "movement_samples": [
    {
      "timestamp": "2025-01-15T14:00:00Z",
      "location": { "lat": 37.7749, "lng": -122.4194 },
      "speed_mps": 1.2,
      "accuracy_meters": 5,
      "activity_type": "WALKING"
    }
  ],
  "summary": {
    "avg_speed_mps": 1.33,
    "max_speed_mps": 2.1,
    "walking_percentage": 0.95,
    "step_count": 3200
  }
}
```

**Response 200:**
```json
{
  "validation": {
    "is_valid": true,
    "confidence": 0.95,
    "validated_distance_meters": 2350,
    "validated_duration_seconds": 1780,
    "points_earned": 235
  },
  "stats_updated": {
    "daily_distance_meters": 7550,
    "daily_walking_minutes": 75,
    "daily_score": 655
  }
}
```

**Errors:**
- `400` - Invalid movement data or suspicious patterns detected
- `429` - Too many validation requests

## WebSocket API

### Connection

```javascript
// Connect to WebSocket
const socket = io('wss://api.walkinggame.com', {
  auth: {
    token: 'Bearer eyJhbGc...'
  }
});
```

### Events from Server

#### leaderboard:update

Emitted when leaderboard positions change.

```json
{
  "event": "leaderboard:update",
  "data": {
    "period": "daily",
    "updated_positions": [
      {
        "rank": 1,
        "user_id": "uuid",
        "username": "walker123",
        "score": 1250,
        "rank_change": 2
      }
    ],
    "affected_user_ids": ["uuid1", "uuid2"],
    "timestamp": "2025-01-15T14:30:00Z"
  }
}
```

#### activity:new

Emitted when a new activity is added to the feed.

```json
{
  "event": "activity:new",
  "data": {
    "id": "uuid",
    "user": {
      "id": "uuid",
      "username": "walker123"
    },
    "activity_type": "collection",
    "data": {
      "entity_type": "treasure",
      "points_earned": 100
    },
    "created_at": "2025-01-15T14:30:00Z"
  }
}
```

#### entity:collected

Emitted when an entity in the user's vicinity is collected by someone.

```json
{
  "event": "entity:collected",
  "data": {
    "entity_id": "uuid",
    "collector_username": "walker123",
    "distance_from_you_meters": 245,
    "timestamp": "2025-01-15T14:30:00Z"
  }
}
```

### Events from Client

#### subscribe:leaderboard

```json
{
  "event": "subscribe:leaderboard",
  "period": "daily"
}
```

#### subscribe:nearby

Subscribe to events in a geographic area.

```json
{
  "event": "subscribe:nearby",
  "location": {
    "lat": 37.7749,
    "lng": -122.4194
  },
  "radius_meters": 1000
}
```

#### unsubscribe:nearby

```json
{
  "event": "unsubscribe:nearby"
}
```

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid movement data provided",
    "details": {
      "field": "movement_data.gps_speed_mps",
      "issue": "Speed exceeds walking threshold"
    },
    "timestamp": "2025-01-15T14:30:00Z"
  }
}
```

### Error Codes

- `VALIDATION_ERROR` - Request validation failed
- `AUTHENTICATION_ERROR` - Invalid or missing token
- `AUTHORIZATION_ERROR` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `MOVEMENT_VALIDATION_FAILED` - Movement data indicates cheating
- `ENTITY_ALREADY_COLLECTED` - Cannot collect twice
- `DISTANCE_TOO_FAR` - User not within collection radius
- `SERVER_ERROR` - Internal server error

## Rate Limits

| Endpoint | Rate Limit |
|----------|------------|
| POST /auth/register | 5 per hour per IP |
| POST /auth/login | 10 per hour per IP |
| POST /entities/collect | 1 per second per user |
| POST /entities/treasure | 10 per hour per user |
| GET /entities/nearby | 60 per minute per user |
| GET /leaderboard/* | 120 per minute per user |
| POST /movement/validate | 1 per 5 seconds per user |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1642267200
```

## Pagination

All list endpoints support cursor-based pagination:

```http
GET /activities/feed?limit=50&cursor=eyJpZCI6InV1aWQiLCJ0cyI6MTY0MjI2NzIwMH0=
```

Response includes cursor for next page:
```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6InV1aWQyIiwidHMiOjE2NDIyNjcxMDB9",
    "has_more": true
  }
}
```

## Versioning

API version is included in the URL path (`/api/v1/`). Breaking changes will increment the version number.

## Next Steps

1. Review movement detection: `07-MOVEMENT-DETECTION.md`
2. Set up backend: `04-SETUP-BACKEND.md`
3. Implement API endpoints
