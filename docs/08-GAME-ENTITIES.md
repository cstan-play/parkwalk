# Game Entities System

## Overview

The game entities system is designed for extensibility, but the Phase 1
implementation is intentionally narrower: shared collectible rows in
`game_entities`, collected through one server-side collect transaction. The
plugin-style entity architecture below is the direction for future entity
types, not a framework that exists in code today.

## Placement Model

Most location games combine several placement modes rather than relying on one
global scatter pass:

- **Shared world spawns**: server-owned entities placed into the world and
  visible to any eligible player. This is the default ParkWalk model today.
- **User/session-relative spawns**: temporary entities generated near a player
  for onboarding, testing, events, or route-based sessions.
- **User-created entities**: treasures or meeting points manually placed by a
  player, usually with moderation, cooldown, and anti-spam rules.
- **Route spawns**: entities distributed along a path the player intends to
  walk. This should be a separate placement context, not a special case inside
  collection validation.

### Phase 1 placement modes

ParkWalk currently has two backend placement paths:

1. **Manual/dev seed script**: `backend/prisma/seed.ts` deletes prior dev
   entities and places a Poisson-disc cluster around `SEED_CENTER_LAT/LNG`.
   Use this when preparing a known first-walk route. When walkable snapping is
   enabled, the seed script first tries to place markers on Mapbox Streets
   walkable ways, then falls back to random placement unless
   `WALKABLE_SNAP_REQUIRED=true`.
2. **Nearby auto-seed helper**: when `NEARBY_AUTO_SEED_ENABLED=true`,
   `GET /api/v1/entities/nearby` tops up a shared cluster of collectibles
   around the requested `lat/lng` if the authenticated user sees fewer than
   `NEARBY_AUTO_SEED_TARGET_COUNT` uncollected collectibles. This is for
   dogfooding and local testing; it is off by default.

The auto-seed helper is intentionally **shared-world**, not private to one
user. It writes real `game_entities` rows, so another user nearby can see and
collect the same markers unless they have already collected them. It does not
delete existing entities. Placement metadata is stored under:

```json
{
  "placement": {
    "source": "nearby_auto_seed",
    "version": 1,
    "center": { "latitude": 55.6761, "longitude": 12.5683 },
    "radiusMeters": 140,
    "generatedAt": "2026-04-24T10:00:00.000Z"
  }
}
```

When walkable snapping is enabled, newly inserted rows use placement
`version: 2` and keep the same compatibility keys while adding `snap` metadata:

```json
{
  "placement": {
    "source": "nearby_auto_seed",
    "version": 2,
    "center": { "latitude": 55.6761, "longitude": 12.5683 },
    "radiusMeters": 140,
    "generatedAt": "2026-05-06T10:00:00.000Z",
    "snap": {
      "status": "snapped",
      "provider": "mapbox_tilequery",
      "distanceMeters": 6.5,
      "featureId": "123",
      "class": "path",
      "type": "footway",
      "name": "Campus Walk"
    }
  }
}
```

If Mapbox returns no usable walkable way or the provider is unavailable,
auto-seeding inserts `version: 2` rows with
`snap.status = "fallback_unsnapped"` so the field test still has markers.
Manual seed behaves the same unless `WALKABLE_SNAP_REQUIRED=true`, in which
case it fails loudly.

Config knobs:

| Env var                                  | Purpose                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NEARBY_AUTO_SEED_ENABLED`               | Enables `/nearby` top-up behavior. Keep false in production until spawn policy is finalized. |
| `NEARBY_AUTO_SEED_TARGET_COUNT`          | Number of visible uncollected collectibles to maintain around the queried location.          |
| `NEARBY_AUTO_SEED_RADIUS_METERS`         | Max scatter radius around the user/query point.                                              |
| `NEARBY_AUTO_SEED_MIN_DISTANCE_METERS`   | Avoids spawning directly on top of the user.                                                 |
| `NEARBY_AUTO_SEED_MIN_SPACING_METERS`    | Avoids overlapping markers / collection radii.                                               |
| `WALKABLE_SNAPPING_ENABLED`              | Enables Mapbox Tilequery snapping for nearby auto-seed and manual/dev seed.                  |
| `MAPBOX_ACCESS_TOKEN`                    | Server-side Mapbox token required when snapping is enabled.                                  |
| `WALKABLE_SNAP_MAX_METERS`               | Max distance from a probe point to a walkable way. Default: 35m.                             |
| `WALKABLE_SNAP_CACHE_TTL_SECONDS`        | Redis/in-memory cache lifetime for quantized Tilequery probes. Default: 86400.               |
| `WALKABLE_SNAP_REQUIRED`                 | Makes seed/snapping failure hard-fail instead of falling back. Default: false.               |
| `WALKABLE_TILEQUERY_MAX_CALLS`           | Per request/seed-run Tilequery probe budget. Default: 8.                                     |

### Walkable-way snapping

The backend uses Mapbox Streets Tilequery against `mapbox.mapbox-streets-v8`
with `layers=road`, `geometry=linestring`, and a bounded probe budget. Tilequery
returns point coordinates at the closest point on the line feature, so ParkWalk
does not calculate nearest-point-on-line itself.

Accepted walkable features are deliberately conservative:

- `class=pedestrian`
- `class=path` with `type=footway`, `sidewalk`, `crossing`, `steps`, `path`,
  `hiking`, or `trail`

The v1 filter excludes cycleways, mountain-bike trails, pistes, bridleways,
service roads, and normal vehicle streets. After snapping, the backend still
validates spawn radius, minimum distance from the user/query center, and spacing
from existing/newly placed collectibles.

### Future placement contexts

The next architectural step is a first-class `placement` module with explicit
contexts:

- `nearby_auto_seed`: dev/test dogfooding near current location.
- `route`: generated from route geometry, placing markers every N meters with
  jitter and walkable-way snapping.
- `user_treasure`: user-created placement with cooldowns, creator ownership,
  abuse limits, and max-collection rules.
- `event`: scheduled clusters for parks, campuses, or timed alpha tests.

Collection should remain independent of placement mode: once an entity exists,
the same server-side movement validation, uncertainty-aware distance gate,
idempotency, and duplicate-collection rules apply.

## Entity Types

### Current Types

- **Collectible**: fixed/shared spawn points collected once per user. This is
  the only entity type exercised by the current first-walk loop.

### Future Types

- Treasure: user-placed items others can find.
- Challenge: tasks with specific requirements.
- Meeting Point: locations for social gatherings.
- Quest chains
- Timed events
- Team challenges
- Virtual pets/companions
- AR objects

## Architecture

### Polymorphic Database Model

All entities stored in single `game_entities` table (see `02-DATABASE-SCHEMA.md`):

```typescript
interface GameEntity {
  id: string;
  type: string; // Entity type identifier
  creator_id: string | null;
  location: Geography; // PostGIS point
  active: boolean;
  visible_from: Date;
  visible_until: Date | null;
  config: Record<string, any>; // Type-specific data
  collection_radius_meters: number;
  max_collections: number | null;
  current_collections: number;
  created_at: Date;
  updated_at: Date;
}
```

### Plugin System

Each entity type is a plugin with standardized interface:

```typescript
// Base entity plugin interface
interface IEntityPlugin {
  // Type identifier
  type: string;

  // Validation
  validateConfig(config: any): ValidationResult;

  // Collection rules
  canCollect(user: User, entity: GameEntity): boolean;
  onCollect(user: User, entity: GameEntity): CollectionResult;

  // Spawning (for auto-spawned entities)
  shouldSpawn?(location: Location): boolean;

  // Respawn logic (for collectibles)
  shouldRespawn?(entity: GameEntity): boolean;

  // UI rendering
  getMarkerConfig(): MarkerConfig;
  getDetailView(): React.ComponentType<{ entity: GameEntity }>;
}
```

## Entity Type Implementations

### 1. Treasure Plugin

```typescript
class TreasurePlugin implements IEntityPlugin {
  type = 'treasure';

  validateConfig(config: any): ValidationResult {
    const schema = z.object({
      name: z.string().min(3).max(50),
      description: z.string().max(200),
      rarity: z.enum(['common', 'rare', 'legendary']),
      points: z.number().min(10).max(1000),
      hint: z.string().max(100).optional(),
      image_url: z.string().url().optional(),
    });

    try {
      schema.parse(config);
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: error.errors };
    }
  }

  canCollect(user: User, entity: GameEntity): boolean {
    // Cannot collect your own treasure
    if (entity.creator_id === user.id) {
      return false;
    }

    // Check if already collected
    const hasCollected = await this.checkCollectionHistory(user.id, entity.id);
    return !hasCollected;
  }

  async onCollect(user: User, entity: GameEntity): Promise<CollectionResult> {
    const points = entity.config.points || 50;

    // Award points based on rarity
    const rarityMultiplier =
      {
        common: 1.0,
        rare: 1.5,
        legendary: 2.0,
      }[entity.config.rarity] || 1.0;

    const finalPoints = Math.round(points * rarityMultiplier);

    // Update creator stats (they get partial credit)
    await this.updateCreatorStats(entity.creator_id, {
      treasures_found_by_others: +1,
    });

    return {
      success: true,
      points_earned: finalPoints,
      rewards: {
        achievement: this.checkForAchievements(user, entity),
      },
      should_deactivate:
        entity.max_collections !== null && entity.current_collections + 1 >= entity.max_collections,
    };
  }

  getMarkerConfig(): MarkerConfig {
    return {
      icon: '💎',
      color: '#FFD700',
      size: 'medium',
    };
  }

  getDetailView() {
    return TreasureDetailView;
  }

  private checkForAchievements(user: User, entity: GameEntity): string[] {
    const achievements = [];

    // First legendary treasure
    if (entity.config.rarity === 'legendary') {
      if (user.stats.legendary_treasures === 0) {
        achievements.push('first_legendary');
      }
    }

    return achievements;
  }
}
```

### 2. Collectible Plugin

```typescript
class CollectiblePlugin implements IEntityPlugin {
  type = 'collectible';

  validateConfig(config: any): ValidationResult {
    const schema = z.object({
      name: z.string(),
      type: z.string(), // badge, coin, etc.
      points: z.number().min(1),
      respawn_seconds: z.number().min(60),
      spawn_probability: z.number().min(0).max(1).optional(),
    });

    try {
      schema.parse(config);
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: error.errors };
    }
  }

  canCollect(user: User, entity: GameEntity): boolean {
    // Collectibles can be collected multiple times
    // But check cooldown
    const lastCollection = await this.getLastCollection(user.id, entity.id);

    if (lastCollection) {
      const cooldownMs = entity.config.respawn_seconds * 1000;
      const timeSince = Date.now() - lastCollection.collected_at.getTime();
      return timeSince >= cooldownMs;
    }

    return true;
  }

  async onCollect(user: User, entity: GameEntity): Promise<CollectionResult> {
    return {
      success: true,
      points_earned: entity.config.points,
      rewards: {},
      should_deactivate: false, // Never deactivate
    };
  }

  shouldRespawn(entity: GameEntity): boolean {
    // Check if enough time has passed since last collection
    const lastCollectionTime = entity.config.last_respawn_at;
    if (!lastCollectionTime) return false;

    const respawnTime =
      new Date(lastCollectionTime).getTime() + entity.config.respawn_seconds * 1000;

    return Date.now() >= respawnTime;
  }

  getMarkerConfig(): MarkerConfig {
    return {
      icon: '⭐',
      color: '#4CAF50',
      size: 'small',
    };
  }

  getDetailView() {
    return CollectibleDetailView;
  }
}
```

### 3. Challenge Plugin

```typescript
class ChallengePlugin implements IEntityPlugin {
  type = 'challenge';

  validateConfig(config: any): ValidationResult {
    const schema = z.object({
      name: z.string(),
      description: z.string(),
      challenge_type: z.enum(['distance_time', 'collection_count', 'treasure_hunt']),
      requirements: z.object({
        target_distance_meters: z.number().optional(),
        target_collections: z.number().optional(),
        time_limit_seconds: z.number().optional(),
        required_entity_ids: z.array(z.string()).optional(),
      }),
      rewards: z.object({
        points: z.number(),
        badge: z.string().optional(),
      }),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    });

    try {
      schema.parse(config);
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: error.errors };
    }
  }

  canCollect(user: User, entity: GameEntity): boolean {
    // Check if user has already completed this challenge
    return !this.hasCompleted(user.id, entity.id);
  }

  async onCollect(user: User, entity: GameEntity): Promise<CollectionResult> {
    // "Collecting" a challenge means accepting/starting it
    await this.startChallenge(user.id, entity.id);

    return {
      success: true,
      points_earned: 0, // Points awarded on completion
      rewards: {},
      should_deactivate: false,
    };
  }

  // Challenge-specific: Check progress
  async checkProgress(user: User, entity: GameEntity): Promise<ChallengeProgress> {
    const config = entity.config;
    const userProgress = await this.getUserChallengeProgress(user.id, entity.id);

    switch (config.challenge_type) {
      case 'distance_time':
        const distanceCovered = userProgress.distance_meters || 0;
        const target = config.requirements.target_distance_meters;
        return {
          completed: distanceCovered >= target,
          progress: distanceCovered / target,
          details: {
            current: distanceCovered,
            target: target,
          },
        };

      case 'collection_count':
        const collected = userProgress.collections || 0;
        const targetCount = config.requirements.target_collections;
        return {
          completed: collected >= targetCount,
          progress: collected / targetCount,
          details: {
            current: collected,
            target: targetCount,
          },
        };

      default:
        return { completed: false, progress: 0 };
    }
  }

  getMarkerConfig(): MarkerConfig {
    return {
      icon: '🏆',
      color: '#FF5722',
      size: 'large',
    };
  }

  getDetailView() {
    return ChallengeDetailView;
  }
}
```

### 4. Meeting Point Plugin

```typescript
class MeetingPointPlugin implements IEntityPlugin {
  type = 'meeting_point';

  validateConfig(config: any): ValidationResult {
    const schema = z.object({
      name: z.string(),
      description: z.string(),
      event_time: z.string().datetime(),
      max_participants: z.number().min(2),
      organizer: z.string(),
    });

    try {
      schema.parse(config);
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: error.errors };
    }
  }

  canCollect(user: User, entity: GameEntity): boolean {
    // Check if event hasn't happened yet
    const eventTime = new Date(entity.config.event_time);
    if (eventTime < new Date()) {
      return false;
    }

    // Check if not full
    const participants = this.getParticipants(entity.id);
    return participants.length < entity.config.max_participants;
  }

  async onCollect(user: User, entity: GameEntity): Promise<CollectionResult> {
    // "Collecting" means joining the event
    await this.addParticipant(user.id, entity.id);

    return {
      success: true,
      points_earned: 0, // Points awarded on attendance
      rewards: {},
      should_deactivate: false,
    };
  }

  getMarkerConfig(): MarkerConfig {
    return {
      icon: '📍',
      color: '#2196F3',
      size: 'medium',
    };
  }

  getDetailView() {
    return MeetingPointDetailView;
  }
}
```

## Plugin Registry

Centralized registry for managing plugins:

```typescript
class EntityPluginRegistry {
  private plugins: Map<string, IEntityPlugin> = new Map();

  register(plugin: IEntityPlugin): void {
    this.plugins.set(plugin.type, plugin);
  }

  get(type: string): IEntityPlugin | null {
    return this.plugins.get(type) || null;
  }

  getAllTypes(): string[] {
    return Array.from(this.plugins.keys());
  }

  // Initialize with default plugins
  static initialize(): EntityPluginRegistry {
    const registry = new EntityPluginRegistry();

    registry.register(new TreasurePlugin());
    registry.register(new CollectiblePlugin());
    registry.register(new ChallengePlugin());
    registry.register(new MeetingPointPlugin());

    return registry;
  }
}

// Global registry instance
export const entityRegistry = EntityPluginRegistry.initialize();
```

## Service Layer Usage

```typescript
class GameEntityService {
  async collectEntity(
    userId: string,
    entityId: string,
    movementData: MovementData,
  ): Promise<CollectionResult> {
    const entity = await this.findById(entityId);
    const user = await this.userService.findById(userId);
    const plugin = entityRegistry.get(entity.type);

    if (!plugin) {
      throw new Error(`Unknown entity type: ${entity.type}`);
    }

    // Validate movement
    const movementValid = await this.movementService.validate(movementData);
    if (!movementValid) {
      throw new Error('Movement validation failed');
    }

    // Check if can collect
    if (!plugin.canCollect(user, entity)) {
      throw new Error('Cannot collect this entity');
    }

    // Perform collection
    const result = await plugin.onCollect(user, entity);

    // Update database
    await this.createCollection({
      user_id: userId,
      entity_id: entityId,
      points_earned: result.points_earned,
      movement_validated: true,
    });

    // Update stats
    await this.userService.updateStats(userId, {
      total_collections: +1,
      daily_score: +result.points_earned,
    });

    // Deactivate if needed
    if (result.should_deactivate) {
      await this.deactivateEntity(entityId);
    }

    return result;
  }

  async createEntity(type: string, data: CreateEntityInput): Promise<GameEntity> {
    const plugin = entityRegistry.get(type);

    if (!plugin) {
      throw new Error(`Unknown entity type: ${type}`);
    }

    // Validate config
    const validation = plugin.validateConfig(data.config);
    if (!validation.valid) {
      throw new ValidationError(validation.errors);
    }

    // Create entity
    return await this.db.gameEntity.create({
      data: {
        type,
        creator_id: data.creator_id,
        location: data.location,
        config: data.config,
        collection_radius_meters: data.collection_radius_meters || 10,
      },
    });
  }
}
```

## Adding New Entity Types

To add a new entity type:

1. **Create Plugin Class**

```typescript
class QuestChainPlugin implements IEntityPlugin {
  type = 'quest_chain';

  // Implement all required methods
  validateConfig(config: any): ValidationResult {
    /* ... */
  }
  canCollect(user: User, entity: GameEntity): boolean {
    /* ... */
  }
  onCollect(user: User, entity: GameEntity): Promise<CollectionResult> {
    /* ... */
  }
  getMarkerConfig(): MarkerConfig {
    /* ... */
  }
  getDetailView() {
    return QuestChainDetailView;
  }
}
```

2. **Register Plugin**

```typescript
// In backend initialization
entityRegistry.register(new QuestChainPlugin());
```

3. **Create UI Components**

```typescript
// Mobile: QuestChainDetailView.tsx
// Web: QuestChainCard.tsx
```

4. **Update Database** (if new fields needed)

```sql
-- Config JSONB is flexible, but can add indexes
CREATE INDEX idx_quest_chains ON game_entities((config->>'chain_id'))
  WHERE type = 'quest_chain';
```

## Benefits of This Architecture

✅ **Extensible**: Add new types without touching core code
✅ **Maintainable**: Each type isolated in its own plugin
✅ **Testable**: Easy to unit test individual plugins
✅ **Type-safe**: TypeScript ensures plugin contract compliance
✅ **Flexible**: Config JSONB allows type-specific data
✅ **Performant**: Single table, efficient spatial queries

## Best Practices

1. **Keep plugins stateless**: All state in database
2. **Validate thoroughly**: Use Zod schemas for config validation
3. **Handle edge cases**: What if entity is deleted mid-collection?
4. **Log events**: Track plugin usage for analytics
5. **Version configs**: Allow backward-compatible changes

## Next Steps

1. Review Mapbox integration: `09-MAPBOX-INTEGRATION.md`
2. Implement plugins in backend
3. Create UI components for each type
4. Test with various entity configurations
