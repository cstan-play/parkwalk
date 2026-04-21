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

export async function findNearbyEntities(
  db: PrismaClient | Prisma.TransactionClient,
  params: { lat: number; lng: number; radiusMeters: number; type?: string; limit: number },
): Promise<NearbyRow[]> {
  const { lat, lng, radiusMeters, type, limit } = params;
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
      FROM game_entities
      WHERE active = true
        AND type = ${type}
        AND (visible_until IS NULL OR visible_until > NOW())
        AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
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
    FROM game_entities
    WHERE active = true
      AND (visible_until IS NULL OR visible_until > NOW())
      AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
    ORDER BY distance_meters ASC
    LIMIT ${limit}
  `;
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
      idempotency_key
    ) VALUES (
      ${params.userId}::uuid,
      ${params.entityId}::uuid,
      ST_MakePoint(${params.userLng}, ${params.userLat})::geography,
      ${params.distanceMeters},
      ${params.movementValidated},
      ${params.movementState},
      ${JSON.stringify(params.movementData)}::jsonb,
      ${params.pointsEarned},
      ${params.idempotencyKey}
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
    }[]
  >`
    SELECT id, entity_id, collected_at, distance_from_entity_meters, movement_validated, points_earned
    FROM user_collections
    WHERE user_id = ${userId}::uuid AND idempotency_key = ${idempotencyKey}
  `;
  return rows[0];
}
