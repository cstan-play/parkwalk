# Mapbox Integration & Custom Map Styling

> Status note, 2026-05-06: the current iOS app uses Mapbox Streets through
> `@rnmapbox/maps`. Custom style work and custom collectible graphics are Alpha
> product polish. Offline tile packs are de-prioritized unless field tests show
> cellular map loading is unreliable or a custom map/art direction specifically
> needs local tile packaging.

## Overview

Custom map styling is what makes this app feel like a **game** rather than just
another map app. This guide covers creating unique map aesthetics and
implementing them across mobile and web.

## Current Mobile Map Behavior

The Phase 1 iOS map lives in `mobile/src/screens/MapScreen.tsx` and uses
`@rnmapbox/maps` with Mapbox Streets.

- `MapboxGL.UserLocation` renders the user's current location.
- `MapboxGL.Camera` starts in follow-user mode at zoom 16.
- Nearby collectibles render as `PointAnnotation` markers.
- Tapping a marker runs the uncertainty-aware local distance check before
  sending the collect request.
- The map has no field-debug overlay.

### Recenter control

ParkWalk includes a Google Maps-style recenter button for when the user pans
away from their own location:

1. `MapScreen` listens to Mapbox camera events.
2. When `onCameraChanged` reports an active gesture, the map leaves follow mode.
3. The screen checks the latest GPS coordinate against the visible map bounds
   from the camera event (`state.properties.bounds`).
4. If the user coordinate is outside the viewport, a floating round button is
   shown in the lower-right of the map.
5. Pressing the button restores follow-user mode and hides the control. The app
   intentionally does not call `MapView#getVisibleBounds()` or an explicit
   `camera.flyTo(...)` here, because the native bounds method crashed on-device
   during startup and explicit fly + follow caused duplicate camera motion.

The button is intentionally not part of the removed debug overlay; it is a
normal navigation affordance for field use.

### Walkable-way snapping for collectibles

The backend Alpha placement flow can use Mapbox Streets Tilequery to improve
seeded collectible locations:

- The provider queries `mapbox.mapbox-streets-v8` with `layers=road`,
  `geometry=linestring`, and a bounded per-request probe budget.
- Tilequery returns the closest point on a matching line feature plus
  `properties.tilequery.distance`, so ParkWalk treats the returned point as the
  snapped collectible candidate.
- Accepted features are `class=pedestrian` and `class=path` with walkable
  types such as `footway`, `sidewalk`, `crossing`, `steps`, `path`, `hiking`,
  or `trail`.
- Results are cached by quantized probe point in Redis, with in-memory cache
  fallback for the manual seed script.

This is different from Mapbox Map Matching: Map Matching is a better fit for
cleaning an existing GPS trace, such as a recorded walk route. Tilequery is the
v1 choice for collectible placement because it answers "what walkable line is
near this candidate point?" without adding Overpass or local OSM imports.

Status: Alpha v1 is implemented, enabled on Railway, and visually
field-validated on iPhone with fresh nearby auto-seeded collectibles landing on
walking paths. Keep tuning the accepted feature filter and snap radius as more
neighborhoods are tested.

## Custom Visuals Without Offline Tiles

Offline tiles are not required for the visual direction currently planned:

- Use **Mapbox Studio** for custom map styling and host the style through
  Mapbox's normal online style delivery.
- Use `PointAnnotation`, `MarkerView`, or a `ShapeSource` + symbol layer for
  custom collectible graphics and future game markers.
- Use app-bundled image assets for marker icons, collectible states, and
  lightweight UI decoration.

Consider offline tile packs only if real field tests show repeated map blanking
on cellular, or if a future map/art direction needs local packaged tiles rather
than Mapbox-hosted styles.

## Mapbox Studio Setup

### 1. Create Account & Get Token

1. Go to [mapbox.com](https://mapbox.com) and create account
2. Navigate to Account → Tokens
3. Create a new token with these scopes:
   - `styles:read`
   - `styles:tiles`
   - `fonts:read`
   - `datasets:read`

### 2. Create Custom Style

**Option A: Start from Template**

Mapbox Studio → Styles → New Style → Choose template:

- **Monochrome**: Clean, minimal look
- **Outdoors**: Nature-focused for walking
- **Navigation**: Clear paths and roads

**Option B: Start from Scratch**

- Blank style gives full control
- More work but completely unique

## Custom Style Examples

### Fantasy Game Style

```json
{
  "version": 8,
  "name": "Walking Game - Fantasy",
  "sources": {
    "mapbox": {
      "type": "vector",
      "url": "mapbox://mapbox.mapbox-streets-v8"
    }
  },
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": {
        "background-color": "#f5e6d3"
      }
    },
    {
      "id": "water",
      "type": "fill",
      "source": "mapbox",
      "source-layer": "water",
      "paint": {
        "fill-color": "#a5d6ff",
        "fill-opacity": 0.5
      }
    },
    {
      "id": "parks",
      "type": "fill",
      "source": "mapbox",
      "source-layer": "landuse",
      "filter": ["==", "class", "park"],
      "paint": {
        "fill-color": "#c8e6c9",
        "fill-opacity": 0.6
      }
    },
    {
      "id": "buildings",
      "type": "fill-extrusion",
      "source": "mapbox",
      "source-layer": "building",
      "paint": {
        "fill-extrusion-color": "#d7ccc8",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-opacity": 0.8
      }
    },
    {
      "id": "roads-major",
      "type": "line",
      "source": "mapbox",
      "source-layer": "road",
      "filter": ["in", "class", "motorway", "trunk", "primary"],
      "paint": {
        "line-color": "#bcaaa4",
        "line-width": 4,
        "line-opacity": 0.5
      }
    },
    {
      "id": "roads-minor",
      "type": "line",
      "source": "mapbox",
      "source-layer": "road",
      "filter": ["in", "class", "secondary", "tertiary", "street"],
      "paint": {
        "line-color": "#d7ccc8",
        "line-width": 2,
        "line-opacity": 0.3
      }
    },
    {
      "id": "labels-place",
      "type": "symbol",
      "source": "mapbox",
      "source-layer": "place_label",
      "layout": {
        "text-field": ["get", "name"],
        "text-font": ["Kalam Regular"],
        "text-size": 14
      },
      "paint": {
        "text-color": "#5d4037",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2
      }
    }
  ]
}
```

### Minimal Modern Style

```json
{
  "version": 8,
  "name": "Walking Game - Minimal",
  "sources": {
    "mapbox": {
      "type": "vector",
      "url": "mapbox://mapbox.mapbox-streets-v8"
    }
  },
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": {
        "background-color": "#ffffff"
      }
    },
    {
      "id": "water",
      "type": "fill",
      "source": "mapbox",
      "source-layer": "water",
      "paint": {
        "fill-color": "#e3f2fd"
      }
    },
    {
      "id": "parks",
      "type": "fill",
      "source": "mapbox",
      "source-layer": "landuse",
      "filter": ["==", "class", "park"],
      "paint": {
        "fill-color": "#f1f8e9"
      }
    },
    {
      "id": "roads",
      "type": "line",
      "source": "mapbox",
      "source-layer": "road",
      "paint": {
        "line-color": "#e0e0e0",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2]
      }
    },
    {
      "id": "buildings",
      "type": "fill",
      "source": "mapbox",
      "source-layer": "building",
      "paint": {
        "fill-color": "#fafafa",
        "fill-opacity": 0.6,
        "fill-outline-color": "#e0e0e0"
      }
    }
  ]
}
```

## Mobile Implementation (React Native)

### Custom Map Style

```typescript
import MapboxGL from '@rnmapbox/maps';

// Option 1: Use Mapbox Studio style URL
const MAPBOX_STYLE_URL = 'mapbox://styles/your-username/your-style-id';

// Option 2: Inline JSON style (for small tweaks)
const CUSTOM_STYLE_JSON = {
  version: 8,
  // ... style definition
};

const GameMap: React.FC = () => {
  return (
    <MapboxGL.MapView
      style={{ flex: 1 }}
      styleURL={MAPBOX_STYLE_URL}
      // or styleJSON={CUSTOM_STYLE_JSON}
    >
      <MapboxGL.Camera
        followUserLocation
        followZoomLevel={15}
      />
      <MapboxGL.UserLocation visible />
    </MapboxGL.MapView>
  );
};
```

### Custom Entity Markers

```typescript
import MapboxGL from '@rnmapbox/maps';

interface EntityMarkerProps {
  entity: GameEntity;
  onPress: () => void;
}

const EntityMarker: React.FC<EntityMarkerProps> = ({ entity, onPress }) => {
  const markerIcon = getMarkerIcon(entity.type);
  const markerColor = getMarkerColor(entity.type, entity.config.rarity);

  return (
    <MapboxGL.MarkerView
      id={entity.id}
      coordinate={[entity.location.lng, entity.location.lat]}
    >
      <TouchableOpacity onPress={onPress}>
        <View style={[styles.marker, { backgroundColor: markerColor }]}>
          <Text style={styles.markerIcon}>{markerIcon}</Text>
        </View>
      </TouchableOpacity>
    </MapboxGL.MarkerView>
  );
};

const styles = StyleSheet.create({
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  markerIcon: {
    fontSize: 20,
  },
});

function getMarkerIcon(type: string): string {
  const icons = {
    treasure: '💎',
    collectible: '⭐',
    challenge: '🏆',
    meeting_point: '📍',
  };
  return icons[type as keyof typeof icons] || '📌';
}

function getMarkerColor(type: string, rarity?: string): string {
  if (type === 'treasure') {
    const rarityColors = {
      common: '#4CAF50',
      rare: '#2196F3',
      legendary: '#FFD700',
    };
    return rarityColors[rarity as keyof typeof rarityColors] || '#9E9E9E';
  }

  const typeColors = {
    collectible: '#4CAF50',
    challenge: '#FF5722',
    meeting_point: '#2196F3',
  };
  return typeColors[type as keyof typeof typeColors] || '#9E9E9E';
}
```

### Animated User Location

```typescript
const AnimatedUserLocation: React.FC = () => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <MapboxGL.UserLocation
      visible
      renderMode="custom"
    >
      <Animated.View
        style={[
          styles.userLocationPulse,
          { transform: [{ scale: pulseAnim }] },
        ]}
      />
      <View style={styles.userLocationDot} />
    </MapboxGL.UserLocation>
  );
};
```

### Collection Radius Visualization

```typescript
const CollectionRadius: React.FC<{ entity: GameEntity }> = ({ entity }) => {
  const circleCoords = useMemo(() => {
    // Generate circle polygon
    const center = [entity.location.lng, entity.location.lat];
    const radiusInKm = entity.collection_radius_meters / 1000;
    const points = 64;

    const coords = [];
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const dx = radiusInKm * Math.cos(angle);
      const dy = radiusInKm * Math.sin(angle);
      coords.push([
        center[0] + dx / (111.32 * Math.cos(center[1] * Math.PI / 180)),
        center[1] + dy / 110.574,
      ]);
    }

    return coords;
  }, [entity]);

  return (
    <MapboxGL.ShapeSource
      id={`radius-${entity.id}`}
      shape={{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [circleCoords],
        },
      }}
    >
      <MapboxGL.FillLayer
        id={`radius-fill-${entity.id}`}
        style={{
          fillColor: '#2196F3',
          fillOpacity: 0.1,
        }}
      />
      <MapboxGL.LineLayer
        id={`radius-line-${entity.id}`}
        style={{
          lineColor: '#2196F3',
          lineWidth: 2,
          lineDasharray: [2, 2],
        }}
      />
    </MapboxGL.ShapeSource>
  );
};
```

## Web Implementation (Mapbox GL JS)

### Initialize Map

```typescript
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN!;

const map = new mapboxgl.Map({
  container: 'map-container',
  style: 'mapbox://styles/your-username/your-style-id',
  center: [-122.4194, 37.7749],
  zoom: 12,
});

// Add controls
map.addControl(new mapboxgl.NavigationControl());
map.addControl(
  new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
  }),
);
```

### Custom Markers

```typescript
// Create custom marker element
const createMarkerElement = (entity: GameEntity): HTMLElement => {
  const el = document.createElement('div');
  el.className = 'custom-marker';
  el.style.width = '40px';
  el.style.height = '40px';
  el.style.borderRadius = '50%';
  el.style.backgroundColor = getMarkerColor(entity.type, entity.config.rarity);
  el.style.border = '2px solid white';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontSize = '20px';
  el.style.cursor = 'pointer';
  el.innerHTML = getMarkerIcon(entity.type);

  // Add pulse animation
  el.style.animation = 'pulse 2s infinite';

  return el;
};

// Add markers
entities.forEach((entity) => {
  const el = createMarkerElement(entity);

  const marker = new mapboxgl.Marker(el)
    .setLngLat([entity.location.lng, entity.location.lat])
    .addTo(map);

  // Add popup
  const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
      <div class="entity-popup">
        <h3>${entity.config.name}</h3>
        <p>${entity.type}</p>
        <button onclick="collectEntity('${entity.id}')">Collect</button>
      </div>
    `);

  marker.setPopup(popup);
});
```

### Add CSS Animations

```css
@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

.custom-marker {
  transition: transform 0.2s;
}

.custom-marker:hover {
  transform: scale(1.2);
  z-index: 10;
}

.entity-popup {
  padding: 10px;
}

.entity-popup h3 {
  margin: 0 0 5px 0;
  font-size: 16px;
}

.entity-popup p {
  margin: 0 0 10px 0;
  font-size: 12px;
  color: #666;
}
```

### Cluster Markers

For many entities, use clustering:

```typescript
map.on('load', () => {
  // Add entity source
  map.addSource('entities', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: entities.map((entity) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [entity.location.lng, entity.location.lat],
        },
        properties: {
          id: entity.id,
          type: entity.type,
          name: entity.config.name,
        },
      })),
    },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  // Cluster layer
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'entities',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 10, '#f1f075', 30, '#f28cb1'],
      'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
    },
  });

  // Cluster count
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'entities',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-size': 12,
    },
  });

  // Unclustered point
  map.addLayer({
    id: 'unclustered-point',
    type: 'circle',
    source: 'entities',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#11b4da',
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
});
```

## Performance Optimization

### 1. Viewport-Based Loading

Only load entities in visible area:

```typescript
const loadEntitiesInBounds = async (bounds: mapboxgl.LngLatBounds) => {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  const entities = await apiClient.get('/entities/in-bounds', {
    params: {
      north: ne.lat,
      south: sw.lat,
      east: ne.lng,
      west: sw.lng,
    },
  });

  updateMarkers(entities.data);
};

map.on('moveend', () => {
  loadEntitiesInBounds(map.getBounds());
});
```

### 2. Marker Pooling

Reuse marker instances:

```typescript
class MarkerPool {
  private available: mapboxgl.Marker[] = [];
  private active: Map<string, mapboxgl.Marker> = new Map();

  acquire(entity: GameEntity): mapboxgl.Marker {
    let marker = this.available.pop();

    if (!marker) {
      marker = new mapboxgl.Marker();
    }

    marker.setLngLat([entity.location.lng, entity.location.lat]);
    this.active.set(entity.id, marker);

    return marker;
  }

  release(entityId: string): void {
    const marker = this.active.get(entityId);
    if (marker) {
      marker.remove();
      this.active.delete(entityId);
      this.available.push(marker);
    }
  }
}
```

## Custom Fonts

Add custom fonts for labels:

1. Upload font to Mapbox Studio
2. Reference in style:

```json
{
  "layout": {
    "text-font": ["Your Custom Font Regular"]
  }
}
```

## Testing Different Styles

Create multiple styles for A/B testing:

```typescript
const STYLES = {
  fantasy: 'mapbox://styles/user/fantasy-style',
  minimal: 'mapbox://styles/user/minimal-style',
  dark: 'mapbox://styles/user/dark-style',
};

// Allow users to switch
const switchStyle = (styleName: keyof typeof STYLES) => {
  map.setStyle(STYLES[styleName]);
};
```

## Next Steps

1. Review testing strategy: `10-TESTING-STRATEGY.md`
2. Create custom style in Mapbox Studio
3. Implement marker system
4. Test performance with many entities
