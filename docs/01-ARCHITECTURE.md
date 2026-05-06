# System Architecture

> Status note, 2026-04-27: this is the architecture direction, not a literal
> inventory of implemented services. The current running system is a modular
> Express REST backend plus the iOS app. Android is no longer on the active
> roadmap; web dashboard and WebSocket real-time features are planned later; see
> `00-CURRENT-STATUS.md`.

## Overview

The system is designed as a **microservices-oriented architecture** with three main client applications (iOS, Android, Web) communicating with a unified backend through REST and WebSocket APIs.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   iOS App    │  │  Android App │  │ Web Dashboard│      │
│  │ (React Native)  │ (React Native)  │   (React)    │      │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘      │
│          │                  │                 │             │
│          └──────────────────┼─────────────────┘             │
└───────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   API Gateway      │
                    │   (Express)        │
                    │ - REST endpoints   │
                    │ - WebSocket server │
                    │ - Auth middleware  │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼──────┐    ┌────────▼────────┐    ┌───────▼────────┐
│ Game Service │    │  User Service   │    │ Social Service │
│              │    │                 │    │                │
│ - Entities   │    │ - Auth          │    │ - Leaderboards │
│ - Collections│    │ - Profiles      │    │ - Activities   │
│ - Validation │    │ - Stats         │    │ - Feed         │
└───────┬──────┘    └────────┬────────┘    └───────┬────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Data Layer       │
                    │                    │
                    │ - PostgreSQL       │
                    │ - PostGIS          │
                    │ - Redis            │
                    └────────────────────┘
```

## Component Details

### 1. Mobile Applications (React Native)

#### Layer Structure

```
Mobile App
├── Presentation Layer
│   ├── Screens (Map, Profile, Stats, etc.)
│   ├── Components (Reusable UI)
│   └── Navigation
│
├── Business Logic Layer
│   ├── Movement Detection Engine
│   ├── Game State Manager
│   ├── Collection Validator
│   └── Event Dispatcher
│
├── Data Layer
│   ├── API Client (React Query)
│   ├── Local Storage (AsyncStorage)
│   ├── State Management (Zustand)
│   └── Cache Manager
│
└── Platform Layer
    ├── GPS Service
    ├── Sensor Manager (Accelerometer, Activity Recognition)
    ├── Mapbox Integration
    └── Native Modules
```

#### Key Modules

**Movement Detection Engine**

- Fuses GPS, accelerometer, and activity recognition data
- Validates genuine walking vs vehicle/bike movement
- Runs on background thread to avoid UI blocking
- Accuracy: 95%+ for walking detection

**Game State Manager**

- Manages current game session
- Tracks user position, collected items, active challenges
- Syncs with backend periodically
- Handles offline scenarios

**Collection Validator**

- Checks if user can collect an entity
- Validates proximity (within 10m)
- Validates movement state (must be walking)
- Prevents duplicate collections

### 2. Backend Services

#### Game Service

Handles all game-related logic and entities.

**Responsibilities:**

- CRUD operations for game entities (treasures, collectibles, challenges)
- Proximity queries (PostGIS)
- Collection validation
- Spawn management for fixed collectibles
- Challenge progression tracking

**Key Endpoints:**

- `GET /api/v1/entities/nearby` - Find entities near user
- `POST /api/v1/entities/collect` - Collect an entity
- `POST /api/v1/entities/treasure` - Place a treasure
- `GET /api/v1/entities/:id` - Get entity details

#### User Service

Manages user accounts, authentication, and stats.

**Responsibilities:**

- User registration/login
- Profile management
- Stats calculation and aggregation
- Achievement system
- Session management

**Key Endpoints:**

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`
- `GET /api/v1/users/:id/stats`
- `PATCH /api/v1/users/me`

#### Social Service

Handles leaderboards, activity feeds, and future social features.

**Responsibilities:**

- Leaderboard calculation (daily/weekly/all-time)
- Activity feed generation
- Real-time updates via WebSocket
- Friend management (future)
- Notifications (future)

**Key Endpoints:**

- `GET /api/v1/leaderboard/:period`
- `GET /api/v1/activities/feed`
- `POST /api/v1/activities` - Log activity

**WebSocket Events:**

- `leaderboard:update` - Leaderboard changed
- `activity:new` - New activity in feed
- `entity:collected` - Someone collected nearby entity

### 3. Web Dashboard

#### Architecture

```
Web Dashboard
├── Pages
│   ├── Map (entity management)
│   ├── Leaderboard
│   ├── Profile
│   └── Stats
│
├── Components
│   ├── MapView (Mapbox GL JS)
│   ├── EntityEditor
│   ├── ActivityFeed
│   └── Charts (Recharts)
│
├── Services
│   ├── API Client (shared with mobile)
│   ├── WebSocket Client
│   └── Auth Service
│
└── State Management
    ├── User State
    ├── Map State
    └── Real-time Data
```

**Key Features:**

- View all game entities on map
- Create/edit treasures, challenges, meeting points
- View personal stats and achievements
- Monitor leaderboards
- Browse activity feed
- Manage user profile

### 4. Database Design

#### PostgreSQL with PostGIS

**Why PostGIS?**

- Efficient spatial queries (ST_DWithin for proximity)
- Spatial indexing (GIST index)
- Built-in distance calculations
- Proven performance for location-based apps

**Key Tables:**

- `users` - User accounts
- `game_entities` - All game objects (polymorphic)
- `user_collections` - Collection history
- `user_stats` - Aggregated statistics
- `activities` - Activity feed items
- `sessions` - Active user sessions

**Spatial Queries Example:**

```sql
-- Find all treasures within 100m of user
SELECT * FROM game_entities
WHERE type = 'treasure'
  AND ST_DWithin(
    location,
    ST_MakePoint($userLng, $userLat)::geography,
    100
  )
  AND active = true;
```

#### Redis

**Use Cases:**

- Session storage
- Leaderboard caching (sorted sets)
- Rate limiting
- Real-time activity buffer
- Pub/sub for WebSocket broadcasting

### 5. API Gateway

**Responsibilities:**

- Request routing
- Authentication/authorization (JWT)
- Rate limiting
- Request validation
- Error handling
- CORS configuration
- WebSocket upgrade handling

**Middleware Stack:**

```javascript
Express App
├── CORS
├── Body Parser
├── Compression
├── Rate Limiter
├── JWT Authentication
├── Request Logger
├── Route Handlers (`asyncHandler` for promise rejection forwarding)
└── Error Handler
```

**Async route convention:** Express 4 does not automatically forward rejected
promises from async route handlers into error middleware. Backend routes that
`await` service calls should wrap handlers with
`backend/src/middleware/asyncHandler.ts`; otherwise expected domain errors
like `MOVEMENT_INVALID`, `OUT_OF_RANGE`, or `ALREADY_COLLECTED` can hang the
request instead of returning the JSON error shape.

**Session lifecycle:** Mobile stores access/refresh tokens in iOS Keychain.
The API client retries a single 401 by calling `/api/v1/auth/refresh`,
rotating the refresh session and updating stored tokens. Explicit sign-out
calls `/api/v1/auth/logout` with the current refresh token, then clears
Keychain and Zustand state locally even if the network revoke fails.

## Data Flow Examples

### Collecting a Treasure

```
1. User walks near treasure (mobile app detects via GPS)
2. Mobile app shows "Collect" button
3. User taps "Collect"
4. Mobile validates:
   - Movement state = WALKING_VALID
   - Distance < 10m
   - Not already collected
5. POST /api/v1/entities/collect
   {
     entity_id: "uuid",
     location: {lat, lng},
     movement_data: {
       state: "WALKING_VALID",
       speed: 1.2,
       accuracy: 5
     }
   }
6. Backend validates:
   - JWT authentication
   - Entity exists and active
   - User within range (PostGIS query)
   - Movement data looks legitimate
   - Not duplicate collection
7. Backend creates collection record
8. Backend updates user stats
9. Backend broadcasts via WebSocket:
   - activity:new (to activity feed subscribers)
   - leaderboard:update (if affected)
10. Backend returns success + reward info
11. Mobile updates local state
12. Mobile shows collection animation
```

### Real-time Leaderboard Updates

```
1. User collects item (triggers stats update)
2. Backend recalculates affected leaderboard positions
3. Backend publishes to Redis pub/sub channel
4. WebSocket server receives pub/sub message
5. WebSocket server broadcasts to all connected clients:
   {
     event: "leaderboard:update",
     data: {
       period: "daily",
       updated_positions: [
         {user_id, username, score, rank}
       ]
     }
   }
6. Web dashboard receives update
7. Leaderboard UI updates without page refresh
```

## Scalability Considerations

### Current MVP Architecture

- Single Node.js instance
- Single PostgreSQL instance
- Single Redis instance
- Handles ~1000 concurrent users

### Future Scaling Path

**Horizontal Scaling:**

- Load balancer (NGINX/AWS ALB)
- Multiple Node.js instances
- Sticky sessions for WebSocket (Redis adapter)

**Database Scaling:**

- Read replicas for leaderboard queries
- Partition game_entities by geography
- Separate analytics database

**Caching Strategy:**

- Redis cluster for session distribution
- CDN for static assets (map tiles, images)
- API response caching (short TTL)

**Geospatial Optimization:**

- Spatial partitioning (e.g., by city)
- Entity clustering for distant zoom levels
- Viewport-based entity loading

## Security Architecture

### Authentication

- JWT tokens (access token + refresh token pattern)
- Tokens stored in secure storage (Keychain/Keystore)
- Short expiration (15 min access, 7 day refresh)

### Movement Validation

- Server-side validation of all movement data
- Anomaly detection for impossible speeds
- Rate limiting on collection endpoints
- Geofencing for valid play areas

### Data Privacy

- User location stored only when actively playing
- Historical location data aggregated/anonymized
- GDPR compliance (data export, deletion)
- Encrypted data at rest

### API Security

- Rate limiting (per IP and per user)
- Input validation (Joi/Zod schemas)
- SQL injection prevention (Prisma ORM)
- XSS prevention (sanitized inputs)
- HTTPS only in production

## Performance Targets (MVP)

- **API Response Time**: < 200ms (p95)
- **Map Load Time**: < 2s
- **Movement Detection**: < 100ms processing
- **GPS Update Frequency**: 1-5 seconds (adaptive)
- **WebSocket Latency**: < 50ms
- **Database Queries**: < 50ms (with spatial index)

## Monitoring & Observability

### Metrics to Track

- API response times
- Movement detection accuracy
- Collection success rate
- WebSocket connection health
- Database query performance
- User session duration
- Crash rates (mobile)

### Tools

- Backend: Winston (logging) + Prometheus (metrics)
- Mobile: Sentry (crash reporting)
- Database: pg_stat_statements
- Infrastructure: CloudWatch/DataDog

## Technology Choices Rationale

| Technology   | Why Chosen                           | Alternatives Considered                  |
| ------------ | ------------------------------------ | ---------------------------------------- |
| React Native | Single codebase, fast iteration      | Flutter (less mature ecosystem)          |
| Mapbox       | Style customization, gaming-friendly | Google Maps (limited styling)            |
| PostgreSQL   | Mature, PostGIS for geospatial       | MongoDB (less efficient spatial queries) |
| Express      | Simple, well-documented              | NestJS (overkill for MVP)                |
| Socket.io    | Easy WebSockets, fallback support    | Native WebSockets (more code)            |
| Prisma       | Type-safe ORM, great DX              | TypeORM (less type safety)               |
| Zustand      | Lightweight state management         | Redux (too much boilerplate)             |
| React Query  | Built-in caching, mutations          | SWR (less feature-complete)              |

## Development Principles

1. **Mobile First**: Core experience is mobile
2. **Offline Resilient**: Handle connectivity issues gracefully
3. **Performance**: Movement detection must be real-time
4. **Extensibility**: Plugin architecture for new entity types
5. **Data Integrity**: Server is source of truth
6. **User Privacy**: Minimal location data retention
7. **Fair Play**: Robust cheat prevention

## Next Steps

1. Review database schema: `02-DATABASE-SCHEMA.md`
2. Review API contracts: `03-API-SPECIFICATION.md`
3. Start backend setup: `04-SETUP-BACKEND.md`
