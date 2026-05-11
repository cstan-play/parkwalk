-- Phase 5 — persisted weather snapshot per walk session.
-- Resolved server-side at sync time when the walk has at least one GPS
-- path point. Nullable so older rows and walks without GPS stay valid.
ALTER TABLE "walk_sessions" ADD COLUMN "weather_snapshot" TEXT;
