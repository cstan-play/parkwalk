import type { CollectRequest, CollectResponse, GameEntity, NearbyQuery } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';

import {
  alreadyCollected,
  conflict,
  movementInvalid,
  notFound,
  outOfRange,
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

export async function listNearby(query: NearbyQuery): Promise<GameEntity[]> {
  const rows = await findNearbyEntities(prisma, {
    lat: query.lat,
    lng: query.lng,
    radiusMeters: query.radiusMeters,
    type: query.type,
    limit: query.limit,
  });

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
  const validation = validateMovement({
    summary: request.summary,
    samples: request.samples,
    receivedAt: new Date(),
  });
  if (!validation.valid) {
    throw movementInvalid('Movement validation failed', { reasons: validation.reasons });
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
      if (distance > entity.collection_radius_meters) {
        throw outOfRange(
          `User is ${distance.toFixed(1)}m away; max is ${entity.collection_radius_meters}m`,
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
        },
        pointsEarned: points,
        idempotencyKey,
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
  },
): Promise<CollectResponse> {
  const stats = await tx.userStats.findUnique({ where: { userId: input.userId } });
  return {
    collection: {
      id: input.id,
      entityId: input.entity_id,
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
