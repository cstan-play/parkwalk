-- Enable required extensions on first DB creation. The postgis/postgis image
-- already has PostGIS available; this just ensures it's activated in the
-- parkwalk database along with uuid-ossp for uuid_generate_v4().
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
