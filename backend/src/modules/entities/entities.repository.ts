import type { Prisma, PrismaClient } from '@prisma/client';

export interface NearbyRow {
  id: string;
  type: string;
  creator_id: string | null;
  active: boolean;
  visible_from: Date;
  visible_until: Date | null;
  config: Prisma.JsonValue;
  collection_radius_meters: number;
  max_collections: number | null;
  current_collections: number;
  created_at: Date;
  updated_at: Date;
  lat: number;
  lng: number;
  distance_meters: number;
}

export interface EntityLocationRow {
  id: string;
  lat: number;
  lng: number;
}

export async function findNearbyEntities(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    userId: string;
    lat: number;
    lng: number;
    radiusMeters: number;
    type?: string;
    limit: number;
  },
): Promise<NearbyRow[]> {
  const { userId, lat, lng, radiusMeters, type, limit } = params;
  // NOT EXISTS on user_collections drops entities this user has already
  // collected so the map doesn't re-show a marker the player just picked up.
  // Checked per-user (not globally) because entities with max_collections > 1
  // remain available to other players.
  if (type) {
    return db.$queryRaw<NearbyRow[]>`
      SELECT id,
             type,
             creator_id,
             active,
             visible_from,
             visible_until,
             config,
             collection_radius_meters,
             max_collections,
             current_collections,
             created_at,
             updated_at,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) AS distance_meters
      FROM game_entities ge
      WHERE active = true
        AND type = ${type}
        AND (visible_until IS NULL OR visible_until > NOW())
        AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
        AND NOT EXISTS (
          SELECT 1 FROM user_collections uc
          WHERE uc.user_id = ${userId}::uuid AND uc.entity_id = ge.id
        )
      ORDER BY distance_meters ASC
      LIMIT ${limit}
    `;
  }
  return db.$queryRaw<NearbyRow[]>`
    SELECT id,
           type,
           creator_id,
           active,
           visible_from,
           visible_until,
           config,
           collection_radius_meters,
           max_collections,
           current_collections,
           created_at,
           updated_at,
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng,
           ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) AS distance_meters
    FROM game_entities ge
    WHERE active = true
      AND (visible_until IS NULL OR visible_until > NOW())
      AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
      AND NOT EXISTS (
        SELECT 1 FROM user_collections uc
        WHERE uc.user_id = ${userId}::uuid AND uc.entity_id = ge.id
      )
    ORDER BY distance_meters ASC
    LIMIT ${limit}
  `;
}

export async function findActiveEntityLocations(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    lat: number;
    lng: number;
    radiusMeters: number;
    type?: string;
    limit: number;
  },
): Promise<EntityLocationRow[]> {
  const { lat, lng, radiusMeters, type, limit } = params;
  if (type) {
    return db.$queryRaw<EntityLocationRow[]>`
      SELECT id,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng
      FROM game_entities
      WHERE active = true
        AND type = ${type}
        AND (visible_until IS NULL OR visible_until > NOW())
        AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) ASC
      LIMIT ${limit}
    `;
  }
  return db.$queryRaw<EntityLocationRow[]>`
    SELECT id,
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng
    FROM game_entities
    WHERE active = true
      AND (visible_until IS NULL OR visible_until > NOW())
      AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
    ORDER BY ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) ASC
    LIMIT ${limit}
  `;
}

export async function insertCollectible(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    lat: number;
    lng: number;
    config: Record<string, unknown>;
    collectionRadiusMeters: number;
    maxCollections?: number | null;
  },
): Promise<string> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO game_entities (
      type,
      location,
      config,
      collection_radius_meters,
      max_collections
    ) VALUES (
      'collectible',
      ST_MakePoint(${params.lng}, ${params.lat})::geography,
      ${JSON.stringify(params.config)}::jsonb,
      ${params.collectionRadiusMeters},
      ${params.maxCollections ?? null}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

export interface EntityLockRow {
  id: string;
  type: string;
  active: boolean;
  visible_until: Date | null;
  collection_radius_meters: number;
  max_collections: number | null;
  current_collections: number;
  lat: number;
  lng: number;
  config: Prisma.JsonValue;
}

export async function lockEntityForCollect(
  tx: Prisma.TransactionClient,
  entityId: string,
): Promise<EntityLockRow | undefined> {
  const rows = await tx.$queryRaw<EntityLockRow[]>`
    SELECT id,
           type,
           active,
           visible_until,
           collection_radius_meters,
           max_collections,
           current_collections,
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng,
           config
    FROM game_entities
    WHERE id = ${entityId}::uuid
    FOR UPDATE
  `;
  return rows[0];
}

export async function distanceToEntity(
  tx: Prisma.TransactionClient,
  entityId: string,
  userLat: number,
  userLng: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ distance_meters: number }[]>`
    SELECT ST_Distance(
      location,
      ST_MakePoint(${userLng}, ${userLat})::geography
    ) AS distance_meters
    FROM game_entities
    WHERE id = ${entityId}::uuid
  `;
  return rows[0]?.distance_meters ?? Number.POSITIVE_INFINITY;
}

export async function incrementEntityCollections(
  tx: Prisma.TransactionClient,
  entityId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE game_entities
    SET current_collections = current_collections + 1,
        updated_at = NOW()
    WHERE id = ${entityId}::uuid
  `;
}

export async function insertUserCollection(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    entityId: string;
    userLat: number;
    userLng: number;
    distanceMeters: number;
    movementValidated: boolean;
    movementState: string;
    movementData: unknown;
    pointsEarned: number;
    idempotencyKey: string;
    walkClientId: string;
  },
): Promise<{ id: string; collected_at: Date }> {
  const rows = await tx.$queryRaw<{ id: string; collected_at: Date }[]>`
    INSERT INTO user_collections (
      user_id,
      entity_id,
      user_location,
      distance_from_entity_meters,
      movement_validated,
      movement_state,
      movement_data,
      points_earned,
      idempotency_key,
      walk_client_id
    ) VALUES (
      ${params.userId}::uuid,
      ${params.entityId}::uuid,
      ST_MakePoint(${params.userLng}, ${params.userLat})::geography,
      ${params.distanceMeters},
      ${params.movementValidated},
      ${params.movementState},
      ${JSON.stringify(params.movementData)}::jsonb,
      ${params.pointsEarned},
      ${params.idempotencyKey},
      ${params.walkClientId}::uuid
    )
    RETURNING id, collected_at
  `;
  return rows[0]!;
}

export async function findExistingCollectionByIdempotency(
  tx: Prisma.TransactionClient,
  userId: string,
  idempotencyKey: string,
): Promise<
  | {
      id: string;
      entity_id: string;
      collected_at: Date;
      distance_from_entity_meters: number;
      movement_validated: boolean;
      points_earned: number;
      walk_client_id: string | null;
    }
  | undefined
> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      entity_id: string;
      collected_at: Date;
      distance_from_entity_meters: number;
      movement_validated: boolean;
      points_earned: number;
      walk_client_id: string | null;
    }[]
  >`
    SELECT id, entity_id, collected_at, distance_from_entity_meters, movement_validated, points_earned, walk_client_id
    FROM user_collections
    WHERE user_id = ${userId}::uuid AND idempotency_key = ${idempotencyKey}
  `;
  return rows[0];
}
