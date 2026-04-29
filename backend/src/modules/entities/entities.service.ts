import type { CollectRequest, CollectResponse, GameEntity, NearbyQuery } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';

import {
  alreadyCollected,
  conflict,
  movementInvalid,
  notFound,
  outOfRange,
  walkRequired,
} from '../../errors.js';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { validateMovement } from '../movement/movement.service.js';

import {
  distanceToEntity,
  findExistingCollectionByIdempotency,
  findNearbyEntities,
  incrementEntityCollections,
  insertUserCollection,
  lockEntityForCollect,
} from './entities.repository.js';
import { ensureNearbyCollectibles } from './placement.service.js';

// Cap on how much GPS `horizontalAccuracy` we will subtract from the measured
// distance before checking the collection radius. Prevents an adversary from
// claiming unbounded uncertainty to bypass the gate; 35 m aligns with
// GPS_MAX_ACCURACY_METERS (anything worse is already soft-flagged by movement
// validation). See docs/07-MOVEMENT-DETECTION.md ("Uncertainty-aware collect").
const MAX_ACCURACY_TOLERANCE_M = 35;

export async function listNearby(userId: string, query: NearbyQuery): Promise<GameEntity[]> {
  let rows = await findNearbyEntities(prisma, {
    userId,
    lat: query.lat,
    lng: query.lng,
    radiusMeters: query.radiusMeters,
    type: query.type,
    limit: query.limit,
  });

  const inserted = await ensureNearbyCollectibles({
    visibleCount: rows.length,
    lat: query.lat,
    lng: query.lng,
    queryRadiusMeters: query.radiusMeters,
    type: query.type,
  });
  if (inserted > 0 && rows.length < query.limit) {
    rows = await findNearbyEntities(prisma, {
      userId,
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters,
      type: query.type,
      limit: query.limit,
    });
  }

  return rows.map((r) => ({
    id: r.id,
    type: r.type as GameEntity['type'],
    creatorId: r.creator_id,
    location: { latitude: r.lat, longitude: r.lng },
    active: r.active,
    visibleFrom: r.visible_from.toISOString(),
    visibleUntil: r.visible_until ? r.visible_until.toISOString() : null,
    config: (r.config ?? {}) as Record<string, unknown>,
    collectionRadiusMeters: r.collection_radius_meters,
    maxCollections: r.max_collections,
    currentCollections: r.current_collections,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    distanceMeters: Number(r.distance_meters),
  }));
}

export async function collect(
  userId: string,
  idempotencyKey: string,
  request: CollectRequest,
): Promise<CollectResponse> {
  if (!request.walkSessionId) {
    throw walkRequired();
  }
  const walkSessionId = request.walkSessionId;

  const validation = validateMovement({
    summary: request.summary,
    samples: request.samples,
    receivedAt: new Date(),
  });
  if (!validation.valid) {
    throw movementInvalid('Movement validation failed', {
      reasons: validation.reasons,
      flags: validation.flags,
    });
  }
  // Soft flags accompany a successful validation; they are persisted
  // into collection_log.movement_data.flags for anti-cheat triage but
  // do NOT block the collect. See docs/07-MOVEMENT-DETECTION.md.
  if (validation.flags.length > 0) {
    logger.info(
      { userId, idempotencyKey, flags: validation.flags },
      'collect accepted with soft flags',
    );
  }

  const response = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const dup = await findExistingCollectionByIdempotency(tx, userId, idempotencyKey);
      if (dup) {
        logger.info({ userId, idempotencyKey }, 'idempotent collect replay');
        return await hydrateResponse(tx, {
          id: dup.id,
          entity_id: dup.entity_id,
          collected_at: dup.collected_at,
          distance_meters: Number(dup.distance_from_entity_meters),
          validated: dup.movement_validated,
          points: dup.points_earned,
          userId,
          walkSessionId: dup.walk_client_id ?? walkSessionId,
        });
      }

      const entity = await lockEntityForCollect(tx, request.entityId);
      if (!entity) throw notFound('Entity not found');
      if (!entity.active) throw conflict('Entity is no longer active', 'ENTITY_INACTIVE');
      if (entity.visible_until && entity.visible_until.getTime() < Date.now()) {
        throw conflict('Entity is no longer visible', 'ENTITY_INACTIVE');
      }
      if (entity.max_collections && entity.current_collections >= entity.max_collections) {
        throw conflict('Entity collection cap reached', 'ENTITY_INACTIVE');
      }

      const distance = await distanceToEntity(
        tx,
        entity.id,
        request.location.latitude,
        request.location.longitude,
      );
      // Uncertainty-aware distance gate.
      //
      // The phone reports `horizontalAccuracy` — the radius of a disc around
      // the reported point where the TRUE position could be. Indoors / under
      // heavy Wi-Fi noise this is routinely 15-40 m on iPhone. If we compare
      // raw ST_Distance against the collection radius we reject legitimate
      // collects whenever GPS is uncertain.
      //
      // Instead: accept if the closest point in the uncertainty disc is
      // inside the collection radius, capped so a spoofer can't claim
      // arbitrarily large accuracy to bypass the check.
      //
      // Still hard-reject when even the most generous interpretation puts
      // the user clearly out of range. That catches "I'm 200 m away and
      // spammed the collect button" cases.
      const rawAccuracy = request.location.accuracy ?? 0;
      const tolerance = Math.min(Math.max(rawAccuracy, 0), MAX_ACCURACY_TOLERANCE_M);
      const effectiveDistance = Math.max(0, distance - tolerance);
      const hardLimit = entity.collection_radius_meters * 2 + tolerance;
      if (distance > hardLimit) {
        throw outOfRange(
          `User is ${distance.toFixed(1)}m away (±${tolerance.toFixed(0)}m); max is ${entity.collection_radius_meters}m`,
        );
      }
      if (effectiveDistance > entity.collection_radius_meters) {
        throw outOfRange(
          `User is ${distance.toFixed(1)}m away (±${tolerance.toFixed(0)}m); max is ${entity.collection_radius_meters}m`,
        );
      }

      const existingForEntity = await tx.userCollection.findUnique({
        where: { unique_user_entity_collection: { userId, entityId: entity.id } },
      });
      if (existingForEntity) throw alreadyCollected();

      const config = (entity.config ?? {}) as Record<string, unknown>;
      const points = Number(config.points ?? 0);

      const inserted = await insertUserCollection(tx, {
        userId,
        entityId: entity.id,
        userLat: request.location.latitude,
        userLng: request.location.longitude,
        distanceMeters: distance,
        movementValidated: true,
        movementState: validation.state,
        movementData: {
          summary: request.summary,
          sampleCount: request.samples?.length ?? 0,
          validation,
          flags: validation.flags,
        },
        pointsEarned: points,
        idempotencyKey,
        walkClientId: walkSessionId,
      });

      await incrementEntityCollections(tx, entity.id);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      await tx.userStats.upsert({
        where: { userId },
        update: {
          totalCollections: { increment: 1 },
          dailyCollections: { increment: 1 },
          weeklyCollections: { increment: 1 },
          dailyScore: { increment: points },
          weeklyScore: { increment: points },
          allTimeScore: { increment: points },
          lastActivityDate: today,
        },
        create: {
          userId,
          totalCollections: 1,
          dailyCollections: 1,
          weeklyCollections: 1,
          dailyScore: points,
          weeklyScore: points,
          allTimeScore: points,
          lastActivityDate: today,
        },
      });

      return await hydrateResponse(tx, {
        id: inserted.id,
        entity_id: entity.id,
        collected_at: inserted.collected_at,
        distance_meters: distance,
        validated: true,
        points,
        userId,
        walkSessionId,
      });
    },
    { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
  );

  return response;
}

async function hydrateResponse(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    entity_id: string;
    collected_at: Date;
    distance_meters: number;
    validated: boolean;
    points: number;
    userId: string;
    walkSessionId: string;
  },
): Promise<CollectResponse> {
  const stats = await tx.userStats.findUnique({ where: { userId: input.userId } });
  return {
    collection: {
      id: input.id,
      entityId: input.entity_id,
      walkSessionId: input.walkSessionId,
      collectedAt: input.collected_at.toISOString(),
      distanceFromEntityMeters: Number(input.distance_meters),
      movementValidated: input.validated,
    },
    rewards: {
      pointsEarned: input.points,
      streakDays: stats?.currentStreakDays ?? 0,
      dailyScore: stats?.dailyScore ?? input.points,
      allTimeScore: stats?.allTimeScore ?? input.points,
    },
  };
}
