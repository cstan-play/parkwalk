-- Alpha reset: walk route storage now keeps separate path segments so pause/resume
-- gaps are not rendered as walked distance. Previous walk rows are intentionally
-- discarded for this phase; collection rows keep their history but detach from
-- old walk sessions.
UPDATE "user_collections"
SET "walk_session_id" = NULL,
    "walk_client_id" = NULL
WHERE "walk_session_id" IS NOT NULL
   OR "walk_client_id" IS NOT NULL;

DELETE FROM "walk_sessions";

ALTER TABLE "walk_sessions" DROP COLUMN IF EXISTS "path_geojson";
ALTER TABLE "walk_sessions" ADD COLUMN IF NOT EXISTS "path_segments" JSONB NOT NULL;
