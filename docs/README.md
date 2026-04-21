# Location-Based Walking Game - MVP Documentation

## Project Overview

A cross-platform location-based social walking game where users collect items, hide treasures, and participate in challenges while walking in their city. The system validates that users are genuinely walking (not driving/biking) using GPS and device sensors.

## Key Features

### MVP Scope
- **Movement Detection**: Validates genuine walking using GPS + accelerometer + activity recognition
- **Collectibles System**: Fixed spawn points and user-placed treasures
- **Custom Map**: Unique visual style using Mapbox
- **Web Dashboard**: Map management, leaderboards, stats, activity feed
- **Social Foundation**: Infrastructure for future social features (friends, shared challenges)

## Platform Support

- **iOS**: Native app (React Native)
- **Android**: Native app (React Native)
- **Web**: Dashboard for map management and stats

## Tech Stack Summary

### Mobile (iOS/Android)
- React Native 0.73+
- Mapbox Maps SDK (@rnmapbox/maps)
- Sensor integration (GPS, accelerometer, activity recognition)
- Zustand (state management)
- React Query (API & caching)

### Backend
- Node.js + TypeScript
- Express (REST API)
- Socket.io (real-time updates)
- PostgreSQL 15+ with PostGIS
- Redis (caching & sessions)
- Prisma ORM

### Web Dashboard
- React + TypeScript
- Mapbox GL JS
- Socket.io client
- Recharts (analytics)
- Tailwind CSS

## Documentation Structure

```
docs/
├── README.md (this file)
├── 01-ARCHITECTURE.md          # System architecture & design decisions
├── 02-DATABASE-SCHEMA.md       # Database design & PostGIS setup
├── 03-API-SPECIFICATION.md     # REST API & WebSocket contracts
├── 04-SETUP-BACKEND.md         # Backend setup guide
├── 05-SETUP-MOBILE.md          # React Native setup guide
├── 06-SETUP-WEB.md             # Web dashboard setup guide
├── 07-MOVEMENT-DETECTION.md    # Movement validation algorithm
├── 08-GAME-ENTITIES.md         # Collectibles, treasures, challenges system
├── 09-MAPBOX-INTEGRATION.md    # Custom map styling & implementation
├── 10-TESTING-STRATEGY.md      # Testing approach & tools
└── 11-DEPLOYMENT.md            # Production deployment guide
```

## Quick Start (Development)

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ with PostGIS extension
- Redis 7+
- Xcode (for iOS development)
- Android Studio (for Android development)
- Mapbox account (free tier)

### 1. Clone & Setup Backend
```bash
cd backend
npm install
cp .env.example .env
# Configure .env with database credentials
npm run migrate
npm run dev
```

### 2. Setup Mobile App
```bash
cd mobile
npm install
# iOS
cd ios && pod install && cd ..
npm run ios

# Android
npm run android
```

### 3. Setup Web Dashboard
```bash
cd web
npm install
npm run dev
```

## Development Workflow

1. **Backend First**: Set up API endpoints and database
2. **Mobile Core**: Implement movement detection and map
3. **Game Mechanics**: Build collectibles system
4. **Web Dashboard**: Create management interface
5. **Integration**: Connect all components
6. **Testing**: Validate movement detection accuracy
7. **Polish**: UI/UX refinement

## MVP Development Timeline

- **Week 1-2**: Backend infrastructure + movement detection
- **Week 3-4**: Mobile app core + Mapbox integration
- **Week 5-6**: Game entity system + collection mechanics
- **Week 7**: Web dashboard
- **Week 8**: Integration, testing, polish

## Key Decisions & Rationale

### Why React Native?
- Single codebase for iOS/Android (70-80% code sharing)
- Good sensor access via native modules
- Fast iteration for MVP
- Can optimize with native code later if needed

### Why Mapbox?
- Complete style customization (game-like aesthetics)
- Excellent mobile performance
- Used by similar apps (Pokémon GO, Strava)
- Free tier sufficient for MVP (50k map loads/month)

### Why PostgreSQL + PostGIS?
- PostGIS provides efficient geospatial queries
- Critical for "find nearby treasures" functionality
- Better than NoSQL for complex spatial relationships
- Mature ecosystem

### Why Movement Detection Focus?
- Core differentiator from simple map apps
- Prevents cheating (driving to collect items)
- Enables fair leaderboards
- Foundation for future fitness features

## Next Steps

1. Read `01-ARCHITECTURE.md` for system design overview
2. Follow `04-SETUP-BACKEND.md` to start development
3. Review `07-MOVEMENT-DETECTION.md` for core algorithm
4. Check `03-API-SPECIFICATION.md` for endpoint contracts

## Support & Resources

- [Mapbox Documentation](https://docs.mapbox.com)
- [React Native Documentation](https://reactnative.dev)
- [PostGIS Documentation](https://postgis.net)
- [Prisma Documentation](https://www.prisma.io/docs)

## License

[Your License Here]
