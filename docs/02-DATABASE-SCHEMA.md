# Database Schema

## Overview

The database uses **PostgreSQL 15+** with the **PostGIS** extension for geospatial functionality. The schema is designed for extensibility while maintaining performance for spatial queries.

## Database Setup

### Install PostGIS Extension

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify installation
SELECT PostGIS_Version();
```

## Core Tables

### users

User accounts and basic profile information.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT valid_username CHECK (username ~ '^[a-zA-Z0-9_]{3,50}$'),
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- Indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_last_active ON users(last_active_at DESC);
```

**Settings JSONB Structure:**
```json
{
  "notifications_enabled": true,
  "privacy_mode": false,
  "movement_detection_sensitivity": "normal",
  "preferred_units": "metric"
}
```

### user_stats

Aggregated user statistics for leaderboards and profile display.

```sql
CREATE TABLE user_stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Distance
  total_distance_meters BIGINT DEFAULT 0,
  daily_distance_meters BIGINT DEFAULT 0,
  weekly_distance_meters BIGINT DEFAULT 0,
  
  -- Collections
  total_collections INTEGER DEFAULT 0,
  daily_collections INTEGER DEFAULT 0,
  weekly_collections INTEGER DEFAULT 0,
  
  -- Treasures
  treasures_placed INTEGER DEFAULT 0,
  treasures_found_by_others INTEGER DEFAULT 0,
  
  -- Time
  total_walking_minutes INTEGER DEFAULT 0,
  daily_walking_minutes INTEGER DEFAULT 0,
  
  -- Streaks
  current_streak_days INTEGER DEFAULT 0,
  longest_streak_days INTEGER DEFAULT 0,
  last_activity_date DATE,
  
  -- Scores (for leaderboards)
  daily_score INTEGER DEFAULT 0,
  weekly_score INTEGER DEFAULT 0,
  all_time_score INTEGER DEFAULT 0,
  
  -- Reset timestamps
  daily_reset_at TIMESTAMP WITH TIME ZONE,
  weekly_reset_at TIMESTAMP WITH TIME ZONE,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for leaderboards
CREATE INDEX idx_user_stats_daily_score ON user_stats(daily_score DESC);
CREATE INDEX idx_user_stats_weekly_score ON user_stats(weekly_score DESC);
CREATE INDEX idx_user_stats_all_time_score ON user_stats(all_time_score DESC);
CREATE INDEX idx_user_stats_last_activity ON user_stats(last_activity_date DESC);
```

### game_entities

Polymorphic table for all game objects (treasures, collectibles, challenges, meeting points).

```sql
CREATE TABLE game_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Type and ownership
  type VARCHAR(50) NOT NULL, -- 'treasure', 'collectible', 'challenge', 'meeting_point'
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Location (PostGIS)
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  
  -- Visibility and state
  active BOOLEAN DEFAULT true,
  visible_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  visible_until TIMESTAMP WITH TIME ZONE,
  
  -- Type-specific configuration
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Collection rules
  collection_radius_meters INTEGER DEFAULT 10,
  max_collections INTEGER, -- NULL = unlimited
  current_collections INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_entity_type CHECK (type IN ('treasure', 'collectible', 'challenge', 'meeting_point')),
  CONSTRAINT valid_collection_radius CHECK (collection_radius_meters BETWEEN 5 AND 100)
);

-- Spatial index (critical for performance)
CREATE INDEX idx_game_entities_location ON game_entities USING GIST(location);

-- Type-specific queries
CREATE INDEX idx_game_entities_type_active ON game_entities(type, active) WHERE active = true;

-- Visibility queries
CREATE INDEX idx_game_entities_visibility ON game_entities(visible_from, visible_until) 
  WHERE active = true;

-- Creator lookup
CREATE INDEX idx_game_entities_creator ON game_entities(creator_id) WHERE creator_id IS NOT NULL;
```

**Config JSONB by Type:**

**Treasure:**
```json
{
  "name": "Golden Coin",
  "description": "A rare golden coin hidden by user123",
  "rarity": "legendary",
  "points": 100,
  "image_url": "https://...",
  "hint": "Near the old oak tree"
}
```

**Collectible (Fixed Spawn):**
```json
{
  "name": "City Badge",
  "type": "badge",
  "points": 10,
  "respawn_seconds": 3600,
  "last_respawn_at": "2025-01-15T10:30:00Z"
}
```

**Challenge:**
```json
{
  "name": "Morning Walker",
  "description": "Walk 5km before 9am",
  "challenge_type": "distance_time",
  "target_distance_meters": 5000,
  "time_window_start": "00:00",
  "time_window_end": "09:00",
  "points": 250,
  "difficulty": "medium"
}
```

**Meeting Point:**
```json
{
  "name": "Community Walk Start",
  "description": "Weekly group walk meetup",
  "event_time": "2025-01-20T08:00:00Z",
  "max_participants": 50
}
```

### user_collections

Records every collection event with validation data.

```sql
CREATE TABLE user_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES game_entities(id) ON DELETE CASCADE,
  
  -- Collection details
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Validation data
  user_location GEOGRAPHY(POINT, 4326) NOT NULL,
  distance_from_entity_meters DECIMAL(10, 2),
  movement_validated BOOLEAN NOT NULL,
  movement_state VARCHAR(50), -- 'WALKING_VALID', 'INVALID', etc.
  
  -- Movement data snapshot (for auditing)
  movement_data JSONB,
  
  -- Rewards
  points_earned INTEGER DEFAULT 0,
  
  CONSTRAINT unique_user_entity_collection UNIQUE(user_id, entity_id)
);

-- Indexes
CREATE INDEX idx_user_collections_user ON user_collections(user_id, collected_at DESC);
CREATE INDEX idx_user_collections_entity ON user_collections(entity_id, collected_at DESC);
CREATE INDEX idx_user_collections_time ON user_collections(collected_at DESC);
CREATE INDEX idx_user_collections_validation ON user_collections(movement_validated);
```

**Movement Data JSONB:**
```json
{
  "gps_speed_mps": 1.2,
  "gps_accuracy_meters": 5,
  "accelerometer_pattern": "walking",
  "activity_recognition": "WALKING",
  "step_count_rate": 2.1,
  "validation_score": 0.95
}
```

### activities

Activity feed items for social features.

```sql
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Activity type
  activity_type VARCHAR(50) NOT NULL,
  
  -- Activity data
  data JSONB NOT NULL,
  
  -- Optional related entity
  related_entity_id UUID REFERENCES game_entities(id) ON DELETE SET NULL,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_activity_type CHECK (activity_type IN (
    'collection', 'treasure_placed', 'challenge_completed', 
    'achievement_unlocked', 'streak_milestone'
  ))
);

-- Indexes
CREATE INDEX idx_activities_user ON activities(user_id, created_at DESC);
CREATE INDEX idx_activities_type ON activities(activity_type, created_at DESC);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_related_entity ON activities(related_entity_id) 
  WHERE related_entity_id IS NOT NULL;
```

**Activity Data Examples:**

```json
// Collection
{
  "action": "collected",
  "entity_type": "treasure",
  "entity_name": "Golden Coin",
  "points_earned": 100,
  "location_name": "Central Park"
}

// Treasure Placed
{
  "action": "placed_treasure",
  "treasure_name": "Secret Cache",
  "location_hint": "Near the fountain"
}

// Challenge Completed
{
  "action": "completed_challenge",
  "challenge_name": "Morning Walker",
  "completion_time_seconds": 3245,
  "points_earned": 250
}
```

### sessions

Active user sessions for authentication.

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Token info
  refresh_token_hash VARCHAR(255) NOT NULL,
  device_info JSONB,
  
  -- Session metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- IP and location (for security)
  ip_address INET,
  user_agent TEXT
);

-- Indexes
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Auto-cleanup expired sessions
CREATE INDEX idx_sessions_cleanup ON sessions(expires_at) WHERE expires_at < NOW();
```

### user_achievements

Achievement system (future feature, included for completeness).

```sql
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_type VARCHAR(100) NOT NULL,
  
  -- Achievement data
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  progress_data JSONB,
  
  CONSTRAINT unique_user_achievement UNIQUE(user_id, achievement_type)
);

CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX idx_user_achievements_type ON user_achievements(achievement_type);
```

## Spatial Query Examples

### Find Nearby Entities

```sql
-- Find all active entities within 100 meters of user
SELECT 
  id,
  type,
  config->>'name' as name,
  ST_Distance(
    location,
    ST_MakePoint($userLng, $userLat)::geography
  ) as distance_meters
FROM game_entities
WHERE 
  active = true
  AND ST_DWithin(
    location,
    ST_MakePoint($userLng, $userLat)::geography,
    100 -- radius in meters
  )
  AND (visible_until IS NULL OR visible_until > NOW())
ORDER BY distance_meters ASC
LIMIT 50;
```

### Validate Collection Distance

```sql
-- Check if user is close enough to collect
SELECT EXISTS (
  SELECT 1
  FROM game_entities
  WHERE 
    id = $entityId
    AND active = true
    AND ST_DWithin(
      location,
      ST_MakePoint($userLng, $userLat)::geography,
      collection_radius_meters
    )
) as can_collect;
```

### Find Popular Areas (Heatmap Data)

```sql
-- Find areas with most collections (for heatmap visualization)
SELECT 
  ST_X(location::geometry) as lng,
  ST_Y(location::geometry) as lat,
  COUNT(*) as collection_count
FROM user_collections
WHERE 
  collected_at > NOW() - INTERVAL '7 days'
  AND movement_validated = true
GROUP BY ST_SnapToGrid(location::geometry, 0.001) -- ~100m grid
HAVING COUNT(*) > 5
ORDER BY collection_count DESC
LIMIT 100;
```

## Performance Optimization

### Spatial Index Performance

The GIST index on `game_entities.location` is critical:

```sql
-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM game_entities
WHERE ST_DWithin(
  location,
  ST_MakePoint(-122.4194, 37.7749)::geography,
  1000
);

-- Should show "Index Scan using idx_game_entities_location"
```

### Partitioning (Future Optimization)

For large datasets, partition by geography or time:

```sql
-- Partition user_collections by month
CREATE TABLE user_collections_2025_01 PARTITION OF user_collections
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

## Maintenance Tasks

### Daily Resets

```sql
-- Reset daily stats (run via cron)
UPDATE user_stats
SET 
  daily_distance_meters = 0,
  daily_collections = 0,
  daily_walking_minutes = 0,
  daily_score = 0,
  daily_reset_at = NOW()
WHERE daily_reset_at < CURRENT_DATE;
```

### Weekly Resets

```sql
-- Reset weekly stats (run via cron on Sunday)
UPDATE user_stats
SET 
  weekly_distance_meters = 0,
  weekly_collections = 0,
  weekly_score = 0,
  weekly_reset_at = NOW()
WHERE weekly_reset_at < DATE_TRUNC('week', CURRENT_DATE);
```

### Cleanup Expired Entities

```sql
-- Mark expired entities as inactive
UPDATE game_entities
SET active = false
WHERE 
  active = true
  AND visible_until IS NOT NULL
  AND visible_until < NOW();
```

### Cleanup Old Sessions

```sql
-- Delete expired sessions
DELETE FROM sessions
WHERE expires_at < NOW() - INTERVAL '7 days';
```

## Prisma Schema

For use with Prisma ORM:

```prisma
// schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

model User {
  id            String    @id @default(uuid()) @db.Uuid
  username      String    @unique @db.VarChar(50)
  email         String    @unique @db.VarChar(255)
  passwordHash  String    @map("password_hash") @db.VarChar(255)
  displayName   String?   @map("display_name") @db.VarChar(100)
  avatarUrl     String?   @map("avatar_url")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  lastActiveAt  DateTime  @default(now()) @map("last_active_at") @db.Timestamptz
  isActive      Boolean   @default(true) @map("is_active")
  settings      Json      @default("{}")

  stats         UserStats?
  collections   UserCollection[]
  createdEntities GameEntity[] @relation("EntityCreator")
  activities    Activity[]
  sessions      Session[]
  achievements  UserAchievement[]

  @@map("users")
}

model UserStats {
  userId                  String   @id @map("user_id") @db.Uuid
  totalDistanceMeters     BigInt   @default(0) @map("total_distance_meters")
  dailyDistanceMeters     BigInt   @default(0) @map("daily_distance_meters")
  weeklyDistanceMeters    BigInt   @default(0) @map("weekly_distance_meters")
  totalCollections        Int      @default(0) @map("total_collections")
  dailyCollections        Int      @default(0) @map("daily_collections")
  weeklyCollections       Int      @default(0) @map("weekly_collections")
  treasuresPlaced         Int      @default(0) @map("treasures_placed")
  treasuresFoundByOthers  Int      @default(0) @map("treasures_found_by_others")
  totalWalkingMinutes     Int      @default(0) @map("total_walking_minutes")
  dailyWalkingMinutes     Int      @default(0) @map("daily_walking_minutes")
  currentStreakDays       Int      @default(0) @map("current_streak_days")
  longestStreakDays       Int      @default(0) @map("longest_streak_days")
  lastActivityDate        DateTime? @map("last_activity_date") @db.Date
  dailyScore              Int      @default(0) @map("daily_score")
  weeklyScore             Int      @default(0) @map("weekly_score")
  allTimeScore            Int      @default(0) @map("all_time_score")
  dailyResetAt            DateTime? @map("daily_reset_at") @db.Timestamptz
  weeklyResetAt           DateTime? @map("weekly_reset_at") @db.Timestamptz
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_stats")
}

model GameEntity {
  id                      String    @id @default(uuid()) @db.Uuid
  type                    String    @db.VarChar(50)
  creatorId               String?   @map("creator_id") @db.Uuid
  location                Unsupported("geography(Point, 4326)")
  active                  Boolean   @default(true)
  visibleFrom             DateTime  @default(now()) @map("visible_from") @db.Timestamptz
  visibleUntil            DateTime? @map("visible_until") @db.Timestamptz
  config                  Json      @default("{}")
  collectionRadiusMeters  Int       @default(10) @map("collection_radius_meters")
  maxCollections          Int?      @map("max_collections")
  currentCollections      Int       @default(0) @map("current_collections")
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  creator     User? @relation("EntityCreator", fields: [creatorId], references: [id], onDelete: SetNull)
  collections UserCollection[]
  activities  Activity[]

  @@map("game_entities")
}

// Additional models follow similar pattern...
```

## Backup Strategy

```bash
# Daily backup
pg_dump -Fc walking_game > backup_$(date +%Y%m%d).dump

# Restore
pg_restore -d walking_game backup_20250115.dump
```

## Next Steps

1. Review API specification: `03-API-SPECIFICATION.md`
2. Set up database: `04-SETUP-BACKEND.md`
3. Implement Prisma migrations
