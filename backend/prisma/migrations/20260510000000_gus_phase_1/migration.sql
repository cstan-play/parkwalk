-- Gus Phase 1: chat, personality, prefs, daily state, medications.
-- Companion to docs/16-COMPANION.md and the personality-first plan.

CREATE TABLE "dog_profiles" (
    "user_id" UUID NOT NULL,
    "dog_name" VARCHAR(60) NOT NULL DEFAULT 'Gus',
    "breed_cosmetic" VARCHAR(60),
    "warmth" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verbosity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "political" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "competitiveness" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dog_profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "dog_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "gus_prefs" (
    "user_id" UUID NOT NULL,
    "morning_check_in_time" VARCHAR(5) NOT NULL DEFAULT '07:30',
    "walk_reminder_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "morning_enabled" BOOLEAN NOT NULL DEFAULT true,
    "walk_enabled" BOOLEAN NOT NULL DEFAULT true,
    "post_walk_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" VARCHAR(5) NOT NULL DEFAULT '21:00',
    "quiet_hours_end" VARCHAR(5) NOT NULL DEFAULT '07:00',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Europe/Copenhagen',
    "swearing_ceiling" VARCHAR(10) NOT NULL DEFAULT 'full',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gus_prefs_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "gus_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "role" VARCHAR(10) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "category" VARCHAR(40),
    "content" TEXT NOT NULL,
    "quick_replies" JSONB,
    "selected_reply" VARCHAR(120),
    "model_used" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "chat_messages_user_created_idx" ON "chat_messages"("user_id", "created_at" DESC);

CREATE TABLE "user_daily_state" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "mood" VARCHAR(40),
    "motor_state" VARCHAR(40),
    "tremor" VARCHAR(40),
    "energy" VARCHAR(40),
    "meds_taken" BOOLEAN[] NOT NULL DEFAULT ARRAY[]::BOOLEAN[],
    "free_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_daily_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_daily_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "user_daily_state_user_date_key" ON "user_daily_state"("user_id", "date");
CREATE INDEX "user_daily_state_user_date_idx" ON "user_daily_state"("user_id", "date" DESC);

CREATE TABLE "medications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scheduled_times" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "medications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "medications_user_active_idx" ON "medications"("user_id", "active");
