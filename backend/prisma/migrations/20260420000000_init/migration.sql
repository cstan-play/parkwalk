-- Initial migration: enable PostGIS + uuid-ossp, create core tables, add
-- PostGIS geography columns + GIST indexes that Prisma's schema cannot
-- express natively (Unsupported type).

-- Extensions
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100),
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- sessions
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "device_info" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip_address" INET,
    "user_agent" TEXT,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_refresh_token_hash_idx" ON "sessions"("refresh_token_hash");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- user_stats
CREATE TABLE "user_stats" (
    "user_id" UUID NOT NULL,
    "total_distance_meters" BIGINT NOT NULL DEFAULT 0,
    "daily_distance_meters" BIGINT NOT NULL DEFAULT 0,
    "weekly_distance_meters" BIGINT NOT NULL DEFAULT 0,
    "total_collections" INTEGER NOT NULL DEFAULT 0,
    "daily_collections" INTEGER NOT NULL DEFAULT 0,
    "weekly_collections" INTEGER NOT NULL DEFAULT 0,
    "treasures_placed" INTEGER NOT NULL DEFAULT 0,
    "treasures_found_by_others" INTEGER NOT NULL DEFAULT 0,
    "total_walking_minutes" INTEGER NOT NULL DEFAULT 0,
    "daily_walking_minutes" INTEGER NOT NULL DEFAULT 0,
    "current_streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak_days" INTEGER NOT NULL DEFAULT 0,
    "last_activity_date" DATE,
    "daily_score" INTEGER NOT NULL DEFAULT 0,
    "weekly_score" INTEGER NOT NULL DEFAULT 0,
    "all_time_score" INTEGER NOT NULL DEFAULT 0,
    "daily_reset_at" TIMESTAMPTZ,
    "weekly_reset_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "user_stats_daily_score_idx" ON "user_stats"("daily_score" DESC);
CREATE INDEX "user_stats_weekly_score_idx" ON "user_stats"("weekly_score" DESC);
CREATE INDEX "user_stats_all_time_score_idx" ON "user_stats"("all_time_score" DESC);

-- game_entities (PostGIS geography column)
CREATE TABLE "game_entities" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "type" VARCHAR(50) NOT NULL,
    "creator_id" UUID,
    "location" geography(Point, 4326) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visible_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible_until" TIMESTAMPTZ,
    "config" JSONB NOT NULL DEFAULT '{}',
    "collection_radius_meters" INTEGER NOT NULL DEFAULT 10,
    "max_collections" INTEGER,
    "current_collections" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_entities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "game_entities_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "valid_entity_type" CHECK ("type" IN ('collectible','treasure','challenge','meeting_point')),
    CONSTRAINT "valid_collection_radius" CHECK ("collection_radius_meters" BETWEEN 5 AND 100)
);
CREATE INDEX "game_entities_location_gist" ON "game_entities" USING GIST("location");
CREATE INDEX "game_entities_type_active_idx" ON "game_entities"("type","active") WHERE "active" = true;

-- user_collections (PostGIS geography column, idempotency key)
CREATE TABLE "user_collections" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_location" geography(Point, 4326) NOT NULL,
    "distance_from_entity_meters" DECIMAL(10,2) NOT NULL,
    "movement_validated" BOOLEAN NOT NULL,
    "movement_state" VARCHAR(50) NOT NULL,
    "movement_data" JSONB,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(128),
    CONSTRAINT "user_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "user_collections_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "game_entities"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "unique_user_entity_collection" ON "user_collections"("user_id","entity_id");
CREATE UNIQUE INDEX "unique_user_idempotency" ON "user_collections"("user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "user_collections_user_time_idx" ON "user_collections"("user_id","collected_at" DESC);
CREATE INDEX "user_collections_entity_time_idx" ON "user_collections"("entity_id","collected_at" DESC);
