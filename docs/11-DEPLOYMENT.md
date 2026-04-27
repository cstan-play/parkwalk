# Deployment Guide

> Status note, 2026-04-27: this is a future production deployment reference.
> The current backend deployment path is Railway; use `14-DEPLOY-RAILWAY.md`.
> The web dashboard and mobile store distribution sections are not current
> implementation steps.

## Overview

Production deployment strategy for the walking game MVP. Covers backend API, web dashboard, and mobile app distribution.

## Infrastructure Overview

```
┌─────────────────────────────────────────┐
│         Load Balancer (AWS ALB)         │
└───────────────┬─────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│ API   │   │ API   │   │ API   │  (Auto-scaling)
│ Server│   │ Server│   │ Server│
└───┬───┘   └───┬───┘   └───┬───┘
    │           │           │
    └───────────┼───────────┘
                │
        ┌───────┼───────┐
        │       │       │
    ┌───▼───┐ ┌─▼─────┐ ┌▼────────┐
    │  RDS  │ │ Redis │ │  S3     │
    │(PostGIS)│ │(Cache)│ │(Assets) │
    └───────┘ └───────┘ └─────────┘
```

## Prerequisites

- AWS Account (or alternative cloud provider)
- Domain name
- SSL certificate
- Apple Developer Account (for iOS)
- Google Play Developer Account (for Android)

## Backend Deployment

### Option 1: AWS Elastic Beanstalk (Easiest)

#### 1. Prepare Application

```bash
# In backend directory
npm run build

# Create .ebextensions for configuration
mkdir .ebextensions
```

Create `.ebextensions/nodecommand.config`:

```yaml
option_settings:
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: 'node dist/server.js'
    NodeVersion: 18.x
  aws:elasticbeanstalk:application:environment:
    NODE_ENV: production
    PORT: 8080
```

#### 2. Initialize EB CLI

```bash
# Install EB CLI
pip install awsebcli

# Initialize
eb init walking-game-api --region us-west-2 --platform node.js

# Create environment
eb create production --database.engine postgres --database.version 15
```

#### 3. Configure Environment Variables

```bash
eb setenv \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  JWT_SECRET="..." \
  MAPBOX_ACCESS_TOKEN="..."
```

#### 4. Deploy

```bash
eb deploy
```

#### 5. Set Up Database

```bash
# SSH into instance
eb ssh

# Run migrations
npm run prisma:migrate:deploy
```

### Option 2: Docker + ECS (More Control)

#### Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

#### Build & Push to ECR

```bash
# Build
docker build -t walking-game-api .

# Tag
docker tag walking-game-api:latest <AWS_ACCOUNT>.dkr.ecr.us-west-2.amazonaws.com/walking-game-api:latest

# Push
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT>.dkr.ecr.us-west-2.amazonaws.com
docker push <AWS_ACCOUNT>.dkr.ecr.us-west-2.amazonaws.com/walking-game-api:latest
```

#### ECS Task Definition

```json
{
  "family": "walking-game-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<AWS_ACCOUNT>.dkr.ecr.us-west-2.amazonaws.com/walking-game-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:..."
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/walking-game-api",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### Database Setup (RDS with PostGIS)

#### 1. Create RDS Instance

```bash
aws rds create-db-instance \
  --db-instance-identifier walking-game-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.3 \
  --master-username admin \
  --master-user-password <PASSWORD> \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxx \
  --db-subnet-group-name my-subnet-group \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "mon:04:00-mon:05:00"
```

#### 2. Enable PostGIS

```bash
# Connect to RDS
psql -h walking-game-db.xxx.rds.amazonaws.com -U admin -d postgres

# Enable extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

# Create database
CREATE DATABASE walking_game;
```

#### 3. Run Migrations

```bash
DATABASE_URL="postgresql://admin:password@walking-game-db.xxx.rds.amazonaws.com:5432/walking_game" \
  npm run prisma:migrate:deploy
```

### Redis Setup (ElastiCache)

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id walking-game-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1 \
  --security-group-ids sg-xxx
```

### Load Balancer & SSL

#### 1. Request SSL Certificate (AWS Certificate Manager)

```bash
aws acm request-certificate \
  --domain-name api.walkinggame.com \
  --subject-alternative-names "*.walkinggame.com" \
  --validation-method DNS
```

#### 2. Create Application Load Balancer

```bash
aws elbv2 create-load-balancer \
  --name walking-game-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx
```

#### 3. Configure HTTPS Listener

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:...
```

### Environment Variables (AWS Secrets Manager)

```bash
# Store secrets
aws secretsmanager create-secret \
  --name walking-game/production \
  --secret-string '{
    "DATABASE_URL": "postgresql://...",
    "REDIS_URL": "redis://...",
    "JWT_SECRET": "...",
    "MAPBOX_ACCESS_TOKEN": "..."
  }'
```

## Web Dashboard Deployment

### Option 1: Vercel (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd web
vercel --prod
```

Configure environment variables in Vercel dashboard.

### Option 2: AWS S3 + CloudFront

```bash
# Build
npm run build

# Upload to S3
aws s3 sync build/ s3://walking-game-dashboard --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id EXXXXXXXXXXXXX \
  --paths "/*"
```

#### CloudFront Distribution

```json
{
  "Origins": {
    "Items": [
      {
        "Id": "S3-walking-game-dashboard",
        "DomainName": "walking-game-dashboard.s3.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-walking-game-dashboard",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": true,
    "AllowedMethods": ["GET", "HEAD", "OPTIONS"],
    "CachedMethods": ["GET", "HEAD"],
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    }
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "arn:aws:acm:us-east-1:...",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
```

## Mobile App Deployment

### iOS (TestFlight → App Store)

#### 1. Prepare for Release

```bash
cd ios

# Update version
# In Xcode: Target → General → Version/Build
```

#### 2. Archive

```bash
# Via Xcode
# Product → Archive

# Or via command line
xcodebuild archive \
  -workspace WalkingGameApp.xcworkspace \
  -scheme WalkingGameApp \
  -archivePath build/WalkingGameApp.xcarchive
```

#### 3. Upload to App Store Connect

```bash
xcodebuild -exportArchive \
  -archivePath build/WalkingGameApp.xcarchive \
  -exportPath build/ \
  -exportOptionsPlist ExportOptions.plist

# Upload
xcrun altool --upload-app \
  -f build/WalkingGameApp.ipa \
  -t ios \
  -u your-apple-id \
  -p app-specific-password
```

#### 4. TestFlight

1. Go to App Store Connect
2. Select your app
3. TestFlight tab
4. Add internal testers
5. Submit for external testing (requires review)

#### 5. App Store Submission

1. Create App Store listing
2. Add screenshots, description
3. Set pricing
4. Submit for review

### Android (Internal Testing → Production)

#### 1. Generate Signed APK/AAB

```bash
cd android

# Clean
./gradlew clean

# Build release AAB
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

#### 2. Upload to Google Play Console

1. Go to Google Play Console
2. Create app
3. Internal testing → Create release
4. Upload AAB
5. Add release notes
6. Review and start rollout

#### 3. Production Release

1. Promote from internal testing
2. Add production listing (screenshots, description)
3. Set pricing and distribution
4. Submit for review

### Code Push (Hot Updates)

For non-native changes:

```bash
# Install CodePush CLI
npm install -g appcenter-cli

# Login
appcenter login

# Deploy update (iOS)
appcenter codepush release-react \
  -a YourOrg/WalkingGame-iOS \
  -d Production

# Deploy update (Android)
appcenter codepush release-react \
  -a YourOrg/WalkingGame-Android \
  -d Production
```

## Monitoring & Logging

### Application Monitoring (DataDog/New Relic)

```typescript
// backend/src/app.ts
import { datadogMiddleware } from '@datadog/dd-trace';

app.use(
  datadogMiddleware({
    analytics: true,
  }),
);
```

### Error Tracking (Sentry)

```typescript
// backend
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.errorHandler());
```

```typescript
// mobile
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: '...',
  enableAutoSessionTracking: true,
});
```

### Logging (CloudWatch/LogDNA)

```typescript
import winston from 'winston';
import { WinstonCloudWatch } from 'winston-cloudwatch';

const logger = winston.createLogger({
  transports: [
    new WinstonCloudWatch({
      logGroupName: '/aws/elasticbeanstalk/walking-game-api',
      logStreamName: 'application',
      awsRegion: 'us-west-2',
    }),
  ],
});
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-west-2

      - name: Deploy to Elastic Beanstalk
        run: |
          cd backend
          eb deploy production

  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## Performance Optimization

### Backend

- **Caching**: Redis for leaderboards, user sessions
- **Database**: Connection pooling, read replicas
- **CDN**: CloudFront for static assets
- **Compression**: Gzip responses
- **Rate Limiting**: Prevent abuse

### Mobile

- **Code Splitting**: Lazy load screens
- **Image Optimization**: WebP format, compression
- **Bundle Size**: Analyze and reduce
- **Caching**: AsyncStorage for offline support

## Backup Strategy

### Database Backups

```bash
# Automated RDS backups (daily)
# Manual snapshot before major changes

aws rds create-db-snapshot \
  --db-instance-identifier walking-game-db \
  --db-snapshot-identifier pre-migration-$(date +%Y%m%d)
```

### Restore Procedure

```bash
# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier walking-game-db-restored \
  --db-snapshot-identifier pre-migration-20250115
```

## Scaling Considerations

### Auto-Scaling (ECS)

```json
{
  "minCapacity": 2,
  "maxCapacity": 10,
  "targetCPUUtilization": 70,
  "scaleInCooldown": 300,
  "scaleOutCooldown": 60
}
```

### Database Scaling

- **Vertical**: Increase instance size
- **Horizontal**: Read replicas for queries
- **Partitioning**: Shard by geography if needed

## Cost Estimation (MVP)

**AWS (Monthly)**:

- ECS Fargate (2 tasks): ~$30
- RDS t3.micro: ~$15
- ElastiCache t3.micro: ~$12
- ALB: ~$20
- Data transfer: ~$10
- **Total**: ~$87/month

**Other Services**:

- Mapbox: Free tier (50k loads)
- Vercel: Free tier
- Sentry: Free tier

**Mobile Distribution**:

- Apple Developer: $99/year
- Google Play: $25 one-time

## Rollback Procedure

### Backend

```bash
# EB: Rollback to previous version
eb deploy --version <previous-version>

# ECS: Update service to previous task definition
aws ecs update-service \
  --cluster walking-game \
  --service api \
  --task-definition walking-game-api:42  # Previous revision
```

### Mobile

- iOS: Submit new build with previous code
- Android: Deactivate release, promote previous version

## Security Checklist

- [ ] HTTPS only
- [ ] Environment variables in Secrets Manager
- [ ] Database security groups (private subnet)
- [ ] API rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (using ORM)
- [ ] XSS prevention (sanitized inputs)
- [ ] CORS configured correctly
- [ ] JWT tokens expiring properly
- [ ] Sensitive data encrypted at rest
- [ ] Regular security updates
- [ ] DDoS protection (AWS Shield)

## Go-Live Checklist

- [ ] All tests passing
- [ ] Performance benchmarks met
- [ ] Security audit completed
- [ ] Monitoring configured
- [ ] Error tracking configured
- [ ] Backups automated
- [ ] SSL certificates installed
- [ ] DNS configured
- [ ] Mobile apps approved
- [ ] Documentation updated
- [ ] Support email configured
- [ ] Privacy policy published
- [ ] Terms of service published

## Next Steps

1. Set up staging environment
2. Deploy MVP to staging
3. Perform load testing
4. Submit mobile apps for review
5. Launch! 🚀
