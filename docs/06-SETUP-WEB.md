# Web Dashboard Setup Guide

## Overview

The web dashboard provides:
- Map visualization with all game entities
- Entity management (create treasures, challenges, meeting points)
- Leaderboards and analytics
- User activity feed
- Personal stats

Built with: **React + TypeScript + Mapbox GL JS + Tailwind CSS**

## Initial Setup

### 1. Create React App

```bash
npx create-react-app walking-game-dashboard --template typescript
cd walking-game-dashboard
```

### 2. Install Dependencies

```bash
# Core
npm install react-router-dom
npm install @tanstack/react-query
npm install axios

# Mapbox
npm install mapbox-gl
npm install @types/mapbox-gl

# UI & Styling
npm install tailwindcss postcss autoprefixer
npm install @headlessui/react @heroicons/react
npm install recharts

# WebSocket
npm install socket.io-client

# Forms & Validation
npm install react-hook-form zod @hookform/resolvers

# Date handling
npm install date-fns

# State management (if needed)
npm install zustand
```

### 3. Tailwind CSS Setup

```bash
npx tailwindcss init -p
```

Configure `tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
}
```

Add to `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4. Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── endpoints/
│   │   ├── auth.ts
│   │   ├── entities.ts
│   │   ├── users.ts
│   │   └── leaderboard.ts
│   └── websocket.ts
├── components/
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── Layout.tsx
│   ├── map/
│   │   ├── MapView.tsx
│   │   ├── EntityMarker.tsx
│   │   ├── EntityPopup.tsx
│   │   └── MapControls.tsx
│   ├── entities/
│   │   ├── EntityList.tsx
│   │   ├── EntityForm.tsx
│   │   └── EntityCard.tsx
│   ├── leaderboard/
│   │   ├── LeaderboardTable.tsx
│   │   └── RankCard.tsx
│   ├── stats/
│   │   ├── StatsCards.tsx
│   │   ├── DistanceChart.tsx
│   │   └── ActivityHeatmap.tsx
│   └── common/
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Modal.tsx
│       └── LoadingSpinner.tsx
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── Map.tsx
│   ├── Leaderboard.tsx
│   ├── Profile.tsx
│   └── Settings.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useWebSocket.ts
│   └── useMapbox.ts
├── store/
│   └── authStore.ts
├── utils/
│   ├── constants.ts
│   └── formatting.ts
└── types/
    ├── api.ts
    └── models.ts
```

### 5. Environment Configuration

Create `.env`:

```env
REACT_APP_API_BASE_URL=http://localhost:3000/api/v1
REACT_APP_WS_BASE_URL=ws://localhost:3000
REACT_APP_MAPBOX_TOKEN=your-mapbox-token
```

## Core Implementation

### 1. API Client

Create `src/api/client.ts`:

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const { data } = await axios.post(
          `${process.env.REACT_APP_API_BASE_URL}/auth/refresh`,
          { refresh_token: refreshToken }
        );
        
        localStorage.setItem('access_token', data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        
        return apiClient(originalRequest);
      } catch (refreshError) {
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

### 2. Mapbox Map Component

Create `src/components/map/MapView.tsx`:

```typescript
import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN!;

interface Entity {
  id: string;
  type: string;
  location: { lat: number; lng: number };
  config: any;
}

interface Props {
  entities: Entity[];
  center?: [number, number];
  zoom?: number;
  onEntityClick?: (entity: Entity) => void;
}

const MapView: React.FC<Props> = ({ 
  entities, 
  center = [-122.4194, 37.7749],
  zoom = 12,
  onEntityClick 
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  
  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/your-username/your-style-id', // Custom style
      center: center,
      zoom: zoom,
    });
    
    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    
    return () => {
      map.current?.remove();
    };
  }, []);
  
  // Update markers when entities change
  useEffect(() => {
    if (!map.current) return;
    
    // Remove old markers
    markers.current.forEach(marker => marker.remove());
    markers.current = [];
    
    // Add new markers
    entities.forEach(entity => {
      const el = document.createElement('div');
      el.className = `marker marker-${entity.type}`;
      el.style.width = '30px';
      el.style.height = '30px';
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.backgroundColor = getMarkerColor(entity.type);
      
      const marker = new mapboxgl.Marker(el)
        .setLngLat([entity.location.lng, entity.location.lat])
        .addTo(map.current!);
      
      // Add popup
      const popup = new mapboxgl.Popup({ offset: 25 })
        .setHTML(`
          <div class="p-2">
            <h3 class="font-bold">${entity.config.name}</h3>
            <p class="text-sm">${entity.type}</p>
          </div>
        `);
      
      marker.setPopup(popup);
      
      // Click handler
      el.addEventListener('click', () => {
        onEntityClick?.(entity);
      });
      
      markers.current.push(marker);
    });
  }, [entities, onEntityClick]);
  
  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full"
      style={{ minHeight: '500px' }}
    />
  );
};

function getMarkerColor(type: string): string {
  const colors = {
    treasure: '#FFD700',
    collectible: '#4CAF50',
    challenge: '#FF5722',
    meeting_point: '#2196F3',
  };
  return colors[type as keyof typeof colors] || '#9E9E9E';
}

export default MapView;
```

### 3. Entity Creation Form

Create `src/components/entities/EntityForm.tsx`:

```typescript
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../api/client';

const treasureSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(200),
  rarity: z.enum(['common', 'rare', 'legendary']),
  points: z.number().min(10).max(1000),
  hint: z.string().max(100).optional(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
});

type TreasureFormData = z.infer<typeof treasureSchema>;

interface Props {
  selectedLocation: { lat: number; lng: number } | null;
  onSuccess: () => void;
}

const EntityForm: React.FC<Props> = ({ selectedLocation, onSuccess }) => {
  const queryClient = useQueryClient();
  
  const { register, handleSubmit, formState: { errors } } = useForm<TreasureFormData>({
    resolver: zodResolver(treasureSchema),
    defaultValues: {
      location: selectedLocation || undefined,
    },
  });
  
  const createTreasure = useMutation({
    mutationFn: (data: TreasureFormData) => 
      apiClient.post('/entities/treasure', {
        location: data.location,
        config: {
          name: data.name,
          description: data.description,
          rarity: data.rarity,
          points: data.points,
          hint: data.hint,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      onSuccess();
    },
  });
  
  const onSubmit = (data: TreasureFormData) => {
    createTreasure.mutate(data);
  };
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Treasure Name
        </label>
        <input
          {...register('name')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          placeholder="Golden Coin"
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          {...register('description')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          rows={3}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Rarity
        </label>
        <select
          {...register('rarity')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
        >
          <option value="common">Common</option>
          <option value="rare">Rare</option>
          <option value="legendary">Legendary</option>
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Points
        </label>
        <input
          type="number"
          {...register('points', { valueAsNumber: true })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
        />
      </div>
      
      <button
        type="submit"
        disabled={createTreasure.isPending}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {createTreasure.isPending ? 'Creating...' : 'Create Treasure'}
      </button>
    </form>
  );
};

export default EntityForm;
```

### 4. Leaderboard Component

Create `src/components/leaderboard/LeaderboardTable.tsx`:

```typescript
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../../api/client';

interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
  score: number;
  collections: number;
  distance_meters: number;
  rank_change: number;
}

interface Props {
  period: 'daily' | 'weekly' | 'all_time';
}

const LeaderboardTable: React.FC<Props> = ({ period }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: async () => {
      const { data } = await apiClient.get(`/leaderboard/${period}`);
      return data;
    },
    refetchInterval: 30000, // Refresh every 30s
  });
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Rank
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              User
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Score
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Collections
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Distance
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data?.leaderboard.map((entry: LeaderboardEntry) => (
            <tr key={entry.user.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <span className="text-lg font-bold">{entry.rank}</span>
                  {entry.rank_change > 0 && (
                    <span className="ml-2 text-green-500">↑{entry.rank_change}</span>
                  )}
                  {entry.rank_change < 0 && (
                    <span className="ml-2 text-red-500">↓{Math.abs(entry.rank_change)}</span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  {entry.user.avatar_url && (
                    <img 
                      src={entry.user.avatar_url} 
                      alt="" 
                      className="h-8 w-8 rounded-full mr-3"
                    />
                  )}
                  <div>
                    <div className="font-medium">{entry.user.display_name}</div>
                    <div className="text-sm text-gray-500">@{entry.user.username}</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {entry.score.toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {entry.collections}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {(entry.distance_meters / 1000).toFixed(2)} km
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default LeaderboardTable;
```

### 5. WebSocket Integration

Create `src/hooks/useWebSocket.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

export const useWebSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();
  
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    
    socketRef.current = io(process.env.REACT_APP_WS_BASE_URL!, {
      auth: { token: `Bearer ${token}` },
    });
    
    // Leaderboard updates
    socketRef.current.on('leaderboard:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    });
    
    // Activity feed updates
    socketRef.current.on('activity:new', (data) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    });
    
    return () => {
      socketRef.current?.disconnect();
    };
  }, [queryClient]);
  
  return socketRef.current;
};
```

### 6. Main App Component

Create `src/App.tsx`:

```typescript
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Map from './pages/Map';
import Leaderboard from './pages/Leaderboard';
import Profile from './pages/Profile';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="map" element={<Map />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
```

## Development Workflow

### 1. Start Development Server

```bash
npm start
```

### 2. Build for Production

```bash
npm run build
```

### 3. Environment Variables

Use `.env.production` for production:

```env
REACT_APP_API_BASE_URL=https://api.yourdomain.com/api/v1
REACT_APP_WS_BASE_URL=wss://api.yourdomain.com
REACT_APP_MAPBOX_TOKEN=your-production-token
```

## Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

### Netlify

```bash
npm run build
# Upload dist/ folder to Netlify
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
FROM nginx:alpine
COPY --from=0 /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Next Steps

1. Implement remaining pages
2. Add real-time updates via WebSocket
3. Implement charts with Recharts
4. Add mobile responsiveness
5. Optimize bundle size
