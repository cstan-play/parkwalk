# Testing Strategy

## Overview

Comprehensive testing strategy for the walking game MVP. Focus is on **movement validation accuracy** and **spatial query correctness** — the core differentiators.

## Testing Pyramid

```
        /\
       /  \
      /E2E \
     /------\
    / Integr.\
   /----------\
  /   Unit     \
 /--------------\
```

- **Unit Tests**: 70% - Business logic, algorithms
- **Integration Tests**: 20% - API endpoints, database
- **E2E Tests**: 10% - Critical user flows

## Backend Testing

### Current Commands

The living test setup in this repo is:

```bash
npm --workspace=shared run typecheck
npm --workspace=backend run typecheck
npm --workspace=mobile run typecheck
npm --workspace=backend test
npm --workspace=mobile test -- --runInBand
```

Backend integration tests require local Postgres/PostGIS and Redis. The Jest
config supplies local defaults from `backend/test/integration/env.ts`, matching
`backend/.env.test.example`.

```bash
npm run infra:up
cd backend
npx prisma migrate deploy
npm run test:integration
```

Integration tests boot the real Express app with `supertest`. Async backend
routes are expected to use `asyncHandler` so rejected service promises reach
the shared JSON error middleware; this is covered indirectly by collect
rejection tests for movement, distance, and duplicate collection errors.

### Unit Tests

#### Movement Detection Algorithm

```typescript
// tests/services/movement.test.ts
import { MovementDetector } from '../../src/services/movement';

describe('MovementDetector', () => {
  let detector: MovementDetector;
  
  beforeEach(() => {
    detector = new MovementDetector();
  });
  
  describe('Vehicle Detection', () => {
    it('should detect car when speed > 2.5 m/s', () => {
      const sample = {
        timestamp: Date.now(),
        gps: {
          speed: 5.0, // 18 km/h
          accuracy: 5,
          latitude: 37.7749,
          longitude: -122.4194,
          heading: 90,
        },
        accelerometer: {
          x: 0, y: 0, z: 1,
          magnitude: 1.0,
        },
      };
      
      const result = detector.classify(sample);
      expect(result.state).toBe('VEHICLE');
      expect(result.confidence).toBeGreaterThan(0.9);
    });
    
    it('should reject bike speed (15 km/h)', () => {
      const sample = createSample({ speed: 4.2 }); // 15 km/h
      const result = detector.classify(sample);
      expect(result.state).toBe('VEHICLE');
    });
  });
  
  describe('Walking Detection', () => {
    it('should validate normal walking (5 km/h)', () => {
      const samples = generateWalkingSession({
        avgSpeed: 1.4, // 5 km/h
        duration: 30, // seconds
        gaitFrequency: 2.0, // steps/sec
      });
      
      samples.forEach(sample => {
        const result = detector.classify(sample);
        expect(['WALKING_VALID', 'UNKNOWN']).toContain(result.state);
      });
      
      // After buffer fills, should be confident
      const finalResult = detector.classify(samples[samples.length - 1]);
      expect(finalResult.state).toBe('WALKING_VALID');
      expect(finalResult.confidence).toBeGreaterThan(0.7);
    });
    
    it('should handle GPS inaccuracy gracefully', () => {
      const sample = createSample({ 
        speed: 1.3,
        accuracy: 25, // Poor GPS
      });
      
      const result = detector.classify(sample);
      expect(result.state).toBe('SUSPICIOUS');
    });
  });
  
  describe('Spoof Detection', () => {
    it('should detect instant teleportation', () => {
      const samples = [
        createSample({ lat: 37.7749, lng: -122.4194 }),
        createSample({ lat: 37.7849, lng: -122.4294 }), // 1.5 km away, 1 sec later
      ];
      
      // Implementation should detect impossible movement
    });
  });
});
```

#### Spatial Queries

```typescript
// tests/services/spatial.test.ts
import { SpatialService } from '../../src/services/spatial';
import prisma from '../../src/config/database';

describe('SpatialService', () => {
  let service: SpatialService;
  
  beforeEach(async () => {
    service = new SpatialService(prisma);
    await seedTestEntities();
  });
  
  afterEach(async () => {
    await cleanupTestData();
  });
  
  it('should find entities within radius', async () => {
    const center = { lat: 37.7749, lng: -122.4194 };
    const radius = 100; // meters
    
    const entities = await service.findNearby(center, radius);
    
    // Verify all returned entities are within radius
    entities.forEach(entity => {
      const distance = haversineDistance(center, entity.location);
      expect(distance).toBeLessThanOrEqual(radius);
    });
  });
  
  it('should exclude inactive entities', async () => {
    const center = { lat: 37.7749, lng: -122.4194 };
    const entities = await service.findNearby(center, 1000);
    
    entities.forEach(entity => {
      expect(entity.active).toBe(true);
    });
  });
  
  it('should respect entity visibility windows', async () => {
    // Create entity with future visibility
    await prisma.gameEntity.create({
      data: {
        type: 'treasure',
        location: createPoint(37.7749, -122.4194),
        visible_from: new Date(Date.now() + 86400000), // Tomorrow
        config: { name: 'Future Treasure' },
      },
    });
    
    const entities = await service.findNearby(
      { lat: 37.7749, lng: -122.4194 },
      100
    );
    
    // Should not include future-visible entity
    expect(entities.find(e => e.config.name === 'Future Treasure')).toBeUndefined();
  });
});
```

#### Entity Plugins

```typescript
// tests/plugins/treasure.test.ts
import { TreasurePlugin } from '../../src/plugins/treasure';
import { createMockUser, createMockEntity } from '../helpers';

describe('TreasurePlugin', () => {
  let plugin: TreasurePlugin;
  
  beforeEach(() => {
    plugin = new TreasurePlugin();
  });
  
  it('should validate config schema', () => {
    const validConfig = {
      name: 'Golden Coin',
      description: 'A rare treasure',
      rarity: 'legendary',
      points: 100,
    };
    
    const result = plugin.validateConfig(validConfig);
    expect(result.valid).toBe(true);
  });
  
  it('should reject invalid rarity', () => {
    const invalidConfig = {
      name: 'Coin',
      rarity: 'super-ultra', // Invalid
      points: 100,
    };
    
    const result = plugin.validateConfig(invalidConfig);
    expect(result.valid).toBe(false);
  });
  
  it('should prevent collecting own treasure', async () => {
    const user = createMockUser({ id: 'user-1' });
    const treasure = createMockEntity({
      type: 'treasure',
      creator_id: 'user-1',
    });
    
    const canCollect = await plugin.canCollect(user, treasure);
    expect(canCollect).toBe(false);
  });
  
  it('should apply rarity multiplier correctly', async () => {
    const user = createMockUser();
    const legendaryTreasure = createMockEntity({
      config: {
        points: 50,
        rarity: 'legendary',
      },
    });
    
    const result = await plugin.onCollect(user, legendaryTreasure);
    expect(result.points_earned).toBe(100); // 50 * 2.0
  });
});
```

### Integration Tests

#### API Endpoints

```typescript
// tests/integration/entities.test.ts
import request from 'supertest';
import app from '../../src/app';
import { setupTestDB, teardownTestDB } from '../helpers/database';

describe('Entity API', () => {
  let authToken: string;
  
  beforeAll(async () => {
    await setupTestDB();
    authToken = await getAuthToken();
  });
  
  afterAll(async () => {
    await teardownTestDB();
  });
  
  describe('GET /entities/nearby', () => {
    it('should return nearby entities', async () => {
      const response = await request(app)
        .get('/api/v1/entities/nearby')
        .query({ lat: 37.7749, lng: -122.4194, radius: 500 })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body).toHaveProperty('entities');
      expect(Array.isArray(response.body.entities)).toBe(true);
    });
    
    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/entities/nearby')
        .query({ lat: 37.7749, lng: -122.4194 })
        .expect(401);
    });
    
    it('should validate query parameters', async () => {
      await request(app)
        .get('/api/v1/entities/nearby')
        .query({ lat: 'invalid' }) // Invalid lat
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });
  
  describe('POST /entities/collect', () => {
    it('should collect entity with valid movement', async () => {
      const entity = await createTestEntity({
        type: 'treasure',
        location: { lat: 37.7749, lng: -122.4194 },
      });
      
      const response = await request(app)
        .post('/api/v1/entities/collect')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entity_id: entity.id,
          user_location: { lat: 37.7749, lng: -122.4195 }, // 10m away
          movement_data: generateValidWalkingData(),
        })
        .expect(200);
      
      expect(response.body.collection).toBeDefined();
      expect(response.body.points_earned).toBeGreaterThan(0);
    });
    
    it('should reject collection when too far', async () => {
      const entity = await createTestEntity({
        location: { lat: 37.7749, lng: -122.4194 },
      });
      
      await request(app)
        .post('/api/v1/entities/collect')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entity_id: entity.id,
          user_location: { lat: 37.8000, lng: -122.4000 }, // 3 km away
          movement_data: generateValidWalkingData(),
        })
        .expect(403);
    });
    
    it('should reject vehicle movement', async () => {
      const entity = await createTestEntity({
        location: { lat: 37.7749, lng: -122.4194 },
      });
      
      await request(app)
        .post('/api/v1/entities/collect')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entity_id: entity.id,
          user_location: { lat: 37.7749, lng: -122.4195 },
          movement_data: generateVehicleMovementData(),
        })
        .expect(400);
    });
  });
});
```

## Mobile Testing

### Unit Tests (React Native)

```typescript
// __tests__/hooks/useMovementDetection.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useMovementDetection } from '../../src/hooks/useMovementDetection';

jest.mock('react-native-sensors', () => ({
  accelerometer: {
    subscribe: jest.fn(),
  },
}));

describe('useMovementDetection', () => {
  it('should initialize with UNKNOWN state', () => {
    const { result } = renderHook(() => useMovementDetection());
    
    expect(result.current.state).toBe('UNKNOWN');
    expect(result.current.confidence).toBe(0);
  });
  
  it('should detect walking from sensor data', async () => {
    const { result } = renderHook(() => useMovementDetection());
    
    // Simulate walking sensor data
    act(() => {
      // Trigger sensor callbacks with walking pattern
    });
    
    await waitFor(() => {
      expect(result.current.state).toBe('WALKING_VALID');
    });
  });
});
```

### Component Tests

```typescript
// __tests__/components/EntityMarker.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import EntityMarker from '../../src/components/map/EntityMarker';

describe('EntityMarker', () => {
  const mockEntity = {
    id: '1',
    type: 'treasure',
    location: { lat: 37.7749, lng: -122.4194 },
    config: { name: 'Test Treasure', rarity: 'rare' },
  };
  
  it('should render correctly', () => {
    const { getByText } = render(
      <EntityMarker entity={mockEntity} onPress={jest.fn()} />
    );
    
    expect(getByText('💎')).toBeDefined();
  });
  
  it('should call onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <EntityMarker entity={mockEntity} onPress={onPress} />
    );
    
    fireEvent.press(getByTestId('entity-marker'));
    expect(onPress).toHaveBeenCalledWith(mockEntity);
  });
  
  it('should show correct color for rarity', () => {
    const { getByTestId } = render(
      <EntityMarker entity={mockEntity} onPress={jest.fn()} />
    );
    
    const marker = getByTestId('entity-marker');
    expect(marker.props.style).toContainEqual(
      expect.objectContaining({ backgroundColor: '#2196F3' })
    );
  });
});
```

### E2E Tests (Detox)

```typescript
// e2e/collection.test.ts
import { by, element, expect, device } from 'detox';

describe('Entity Collection Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
    await login('testuser@example.com', 'password');
  });
  
  it('should collect nearby treasure', async () => {
    // Navigate to map
    await element(by.id('map-tab')).tap();
    
    // Wait for map to load
    await waitFor(element(by.id('map-view')))
      .toBeVisible()
      .withTimeout(5000);
    
    // Tap on treasure marker
    await element(by.id('treasure-marker-1')).tap();
    
    // Verify detail view
    await expect(element(by.text('Golden Coin'))).toBeVisible();
    
    // Tap collect button
    await element(by.id('collect-button')).tap();
    
    // Verify success
    await expect(element(by.text('Collected!'))).toBeVisible();
    await expect(element(by.text('+100 points'))).toBeVisible();
  });
  
  it('should show error when not walking', async () => {
    // Simulate stationary movement data
    await device.setMotion({
      type: 'still',
    });
    
    await element(by.id('treasure-marker-2')).tap();
    await element(by.id('collect-button')).tap();
    
    await expect(element(by.text('You must be walking'))).toBeVisible();
  });
});
```

## Web Testing

### Component Tests (React Testing Library)

```typescript
// tests/components/LeaderboardTable.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeaderboardTable from '../../src/components/leaderboard/LeaderboardTable';
import { server } from '../mocks/server';

describe('LeaderboardTable', () => {
  it('should render leaderboard data', async () => {
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <LeaderboardTable period="daily" />
      </QueryClientProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByText('walker123')).toBeInTheDocument();
      expect(screen.getByText('1,250')).toBeInTheDocument(); // Score
    });
  });
  
  it('should show loading state', () => {
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <LeaderboardTable period="daily" />
      </QueryClientProvider>
    );
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
```

## Field Testing

### Real-World Movement Data

Collect real walking/driving/biking sessions:

```bash
# Record session data
node scripts/record-movement-session.js walking 30min > data/walking-30min.json
node scripts/record-movement-session.js driving 15min > data/driving-15min.json
```

### Replay Tests

```typescript
// tests/replay/movement-data.test.ts
import walkingData from '../fixtures/walking-30min.json';
import drivingData from '../fixtures/driving-15min.json';

describe('Real Movement Data Replay', () => {
  it('should validate actual walking session', () => {
    const detector = new MovementDetector();
    
    let walkingCount = 0;
    walkingData.samples.forEach(sample => {
      const result = detector.classify(sample);
      if (result.state === 'WALKING_VALID') {
        walkingCount++;
      }
    });
    
    // At least 80% should be classified as walking
    const walkingPercentage = walkingCount / walkingData.samples.length;
    expect(walkingPercentage).toBeGreaterThan(0.8);
  });
  
  it('should reject actual driving session', () => {
    const detector = new MovementDetector();
    
    let vehicleCount = 0;
    drivingData.samples.forEach(sample => {
      const result = detector.classify(sample);
      if (result.state === 'VEHICLE') {
        vehicleCount++;
      }
    });
    
    const vehiclePercentage = vehicleCount / drivingData.samples.length;
    expect(vehiclePercentage).toBeGreaterThan(0.8);
  });
});
```

## Performance Testing

### Load Testing (k6)

```javascript
// tests/performance/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 50 },   // Stay at 50 for 3 minutes
    { duration: '1m', target: 100 },  // Spike to 100
    { duration: '2m', target: 100 },  // Hold
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // < 1% error rate
  },
};

const BASE_URL = 'https://parkwalk-production.up.railway.app/api/v1';

export default function () {
  // Get nearby entities
  const response = http.get(`${BASE_URL}/entities/nearby?lat=37.7749&lng=-122.4194&radius=500`, {
    headers: { Authorization: `Bearer ${__ENV.AUTH_TOKEN}` },
  });
  
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:15-3.3
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd backend && npm ci
      
      - name: Run migrations
        run: cd backend && npm run prisma:migrate
      
      - name: Run tests
        run: cd backend && npm test
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
  
  mobile-test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: cd mobile && npm ci
      
      - name: Run tests
        run: cd mobile && npm test
```

## Test Coverage Goals

- **Backend**: > 80% coverage
- **Mobile**: > 70% coverage  
- **Web**: > 75% coverage
- **Movement Detection**: > 95% coverage (critical)

## Next Steps

1. Review deployment: `11-DEPLOYMENT.md`
2. Set up test environment
3. Write initial test suite
4. Integrate into CI/CD
