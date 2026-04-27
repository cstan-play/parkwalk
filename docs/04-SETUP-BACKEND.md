# Backend Setup Guide

> Status note, 2026-04-27: this is mostly a historical scaffold guide. The
> backend already exists in `backend/`; for the current hosted path use
> `14-DEPLOY-RAILWAY.md`, and for the current project handoff use
> `00-CURRENT-STATUS.md`.

## Current local backend loop

```bash
npm install
npm run infra:up
cd backend
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

Health checks are at `http://localhost:3000/health` and `/ready`. API routes
are under `/api/v1`.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 15+ with PostGIS extension
- Redis 7+
- Mapbox API key (free tier)

## Initial Setup

### 1. Create Project Structure

```bash
mkdir walking-game-backend
cd walking-game-backend
npm init -y
```

### 2. Install Dependencies

```bash
# Core
npm install express cors helmet compression
npm install @prisma/client socket.io
npm install dotenv joi bcrypt jsonwebtoken

# TypeScript
npm install --save-dev typescript @types/node @types/express
npm install --save-dev @types/bcrypt @types/jsonwebtoken
npm install --save-dev ts-node nodemon

# Database
npm install --save-dev prisma

# Redis
npm install ioredis

# Testing (optional for MVP)
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest

# Utilities
npm install winston morgan
npm install rate-limiter-flexible
```

### 3. TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node", "jest"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 4. Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   ├── redis.ts
│   │   └── env.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── errorHandler.ts
│   │   ├── rateLimiter.ts
│   │   └── validation.ts
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── user.routes.ts
│   │   ├── entity.routes.ts
│   │   ├── leaderboard.routes.ts
│   │   └── activity.routes.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── game.service.ts
│   │   ├── movement.service.ts
│   │   ├── leaderboard.service.ts
│   │   └── activity.service.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── validation.ts
│   │   └── spatial.ts
│   ├── websocket/
│   │   ├── server.ts
│   │   ├── handlers.ts
│   │   └── events.ts
│   ├── types/
│   │   ├── express.d.ts
│   │   └── models.ts
│   ├── app.ts
│   └── server.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

### 5. Environment Configuration

Create `.env.example`:

```env
# Server
NODE_ENV=development
PORT=3000
API_VERSION=v1

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/walking_game?schema=public

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Mapbox (for server-side geocoding if needed)
MAPBOX_ACCESS_TOKEN=your-mapbox-token

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# CORS
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:19006

# Movement Validation
MOVEMENT_MAX_WALKING_SPEED_MPS=2.5
MOVEMENT_MIN_GPS_ACCURACY_METERS=20
MOVEMENT_VALIDATION_CONFIDENCE_THRESHOLD=0.7
```

Copy to `.env`:

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 6. Database Setup

#### Install PostgreSQL with PostGIS

**macOS:**

```bash
brew install postgresql@15 postgis
brew services start postgresql@15
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install postgresql-15 postgresql-15-postgis-3
sudo systemctl start postgresql
```

#### Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE walking_game;

# Connect to database
\c walking_game

# Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

# Verify
SELECT PostGIS_Version();

# Exit
\q
```

#### Initialize Prisma

```bash
npx prisma init
```

Create `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           String   @id @default(uuid()) @db.Uuid
  username     String   @unique @db.VarChar(50)
  email        String   @unique @db.VarChar(255)
  passwordHash String   @map("password_hash")
  displayName  String?  @map("display_name")
  avatarUrl    String?  @map("avatar_url")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  lastActiveAt DateTime @default(now()) @map("last_active_at") @db.Timestamptz
  isActive     Boolean  @default(true) @map("is_active")
  settings     Json     @default("{}")

  @@map("users")
}

// Add other models from DATABASE-SCHEMA.md
```

Run migrations:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 7. Redis Setup

**macOS:**

```bash
brew install redis
brew services start redis
```

**Linux:**

```bash
sudo apt install redis-server
sudo systemctl start redis
```

Test connection:

```bash
redis-cli ping
# Should respond: PONG
```

## Core Implementation

### 1. Database Configuration

Create `src/config/database.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export default prisma;
```

### 2. Redis Configuration

Create `src/config/redis.ts`:

```typescript
import Redis from 'ioredis';
import { env } from './env';

const redis = new Redis(env.REDIS_URL, {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

export default redis;
```

### 3. Environment Validation

Create `src/config/env.ts`:

```typescript
import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required().min(32),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = {
  NODE_ENV: envVars.NODE_ENV,
  PORT: envVars.PORT,
  DATABASE_URL: envVars.DATABASE_URL,
  REDIS_URL: envVars.REDIS_URL,
  JWT_SECRET: envVars.JWT_SECRET,
  JWT_ACCESS_EXPIRATION: envVars.JWT_ACCESS_EXPIRATION,
  JWT_REFRESH_EXPIRATION: envVars.JWT_REFRESH_EXPIRATION,
  MAPBOX_ACCESS_TOKEN: envVars.MAPBOX_ACCESS_TOKEN,
};
```

### 4. Express App Setup

Create `src/app.ts`:

```typescript
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import entityRoutes from './routes/entity.routes';
import leaderboardRoutes from './routes/leaderboard.routes';
import activityRoutes from './routes/activity.routes';

const app: Application = express();

// Security middleware
app.use(helmet());

// CORS
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  }),
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Logging
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
const API_PREFIX = `/api/${env.API_VERSION}`;

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/entities`, entityRoutes);
app.use(`${API_PREFIX}/leaderboard`, leaderboardRoutes);
app.use(`${API_PREFIX}/activities`, activityRoutes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
```

### 5. Server Entry Point

Create `src/server.ts`:

```typescript
import http from 'http';
import app from './app';
import { env } from './config/env';
import { initWebSocket } from './websocket/server';
import prisma from './config/database';
import redis from './config/redis';

const server = http.createServer(app);

// Initialize WebSocket
initWebSocket(server);

const PORT = env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');

  server.close(async () => {
    await prisma.$disconnect();
    await redis.quit();
    console.log('HTTP server closed');
    process.exit(0);
  });
});
```

### 6. Package.json Scripts

Update `package.json`:

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  }
}
```

## Development Workflow

### 1. Start Development Server

```bash
npm run dev
```

### 2. Database Migrations

```bash
# Create migration
npx prisma migrate dev --name add_game_entities

# Reset database (development only)
npx prisma migrate reset

# View database
npx prisma studio
```

### 3. Test API

```bash
# Health check
curl http://localhost:3000/health

# Register user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "Password123!"
  }'
```

## Production Deployment

### 1. Build

```bash
npm run build
```

### 2. Environment Variables

Set production environment variables (never commit `.env`):

```bash
# Use strong secrets
openssl rand -base64 32  # For JWT_SECRET

# Database should be managed instance (AWS RDS, etc.)
DATABASE_URL=postgresql://...

# Redis should be managed instance (ElastiCache, etc.)
REDIS_URL=redis://...
```

### 3. Start Production Server

```bash
NODE_ENV=production npm start
```

### 4. Process Manager (PM2)

```bash
npm install -g pm2

# Start
pm2 start dist/server.js --name walking-game-api

# Monitor
pm2 monit

# Logs
pm2 logs

# Restart
pm2 restart walking-game-api
```

## Monitoring & Debugging

### Database Query Logging

```bash
# Enable query logging in Prisma
# In src/config/database.ts, add log: ['query']
```

### Redis Monitoring

```bash
redis-cli monitor
```

### API Response Times

Morgan logging in development mode shows response times.

## Troubleshooting

### PostGIS Extension Error

```sql
-- If PostGIS fails to install
CREATE EXTENSION postgis CASCADE;
```

### Redis Connection Issues

```bash
# Check Redis is running
redis-cli ping

# Check connection string
echo $REDIS_URL
```

### Port Already in Use

```bash
# Find process on port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

## Next Steps

1. Implement authentication: See `auth.service.ts` examples in movement detection docs
2. Implement game entities: Review `07-MOVEMENT-DETECTION.md`
3. Set up mobile app: `05-SETUP-MOBILE.md`
