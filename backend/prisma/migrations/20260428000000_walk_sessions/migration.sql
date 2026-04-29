CREATE TABLE "walk_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "moving_duration_seconds" INTEGER NOT NULL,
    "paused_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "distance_meters" DECIMAL(10, 2) NOT NULL,
    "step_count" INTEGER NOT NULL,
    "collected_count" INTEGER NOT NULL DEFAULT 0,
    "auto_finished" BOOLEAN NOT NULL DEFAULT false,
    "auto_finish_reason" TEXT,
    "path_point_count" INTEGER NOT NULL,
    "path_geojson" JSONB NOT NULL,
    "pause_intervals" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "walk_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "walk_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "walk_sessions_client_id_key" ON "walk_sessions"("client_id");
CREATE INDEX "walk_sessions_user_started_idx" ON "walk_sessions"("user_id", "started_at" DESC);

ALTER TABLE "user_collections" ADD COLUMN "walk_client_id" UUID;
ALTER TABLE "user_collections" ADD COLUMN "walk_session_id" UUID;

ALTER TABLE "user_collections"
ADD CONSTRAINT "user_collections_walk_session_id_fkey"
FOREIGN KEY ("walk_session_id") REFERENCES "walk_sessions"("id") ON DELETE RESTRICT;

CREATE INDEX "user_collections_walk_session_id_idx" ON "user_collections"("walk_session_id");
CREATE INDEX "user_collections_walk_client_id_idx" ON "user_collections"("walk_client_id");
