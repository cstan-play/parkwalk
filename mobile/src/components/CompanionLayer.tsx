/**
 * Renders the digital companion onto the Mapbox view.
 *
 * Registers the 8 directional arrow placeholders with the map style, then
 * renders a single Point feature whose `sprite` property selects which
 * registered image to draw. The hook's render-state drives both fields.
 *
 * Placement order in the parent must keep this layer ABOVE the active-walk
 * route (so it visually sits on the map) but BELOW collectible markers
 * (so a companion sprite never occludes a tappable marker).
 */

import MapboxGL from '@rnmapbox/maps';
import type { Feature, Point } from 'geojson';
import React, { useMemo } from 'react';

import type { SpriteOrIdle } from '@/companion/direction';
import type { LatLng } from '@/util/geo';

// Relative paths (not the `@/` alias) — Metro's asset plugin reads the
// require argument as a literal path and does not run it through Babel's
// module-resolver. Aliased asset requires return undefined at runtime,
// which then crashes the native Mapbox SymbolLayer.
const SPRITE_IMAGES = {
  'companion-arrow-n': require('../assets/companion/arrow-n.png'),
  'companion-arrow-ne': require('../assets/companion/arrow-ne.png'),
  'companion-arrow-e': require('../assets/companion/arrow-e.png'),
  'companion-arrow-se': require('../assets/companion/arrow-se.png'),
  'companion-arrow-s': require('../assets/companion/arrow-s.png'),
  'companion-arrow-sw': require('../assets/companion/arrow-sw.png'),
  'companion-arrow-w': require('../assets/companion/arrow-w.png'),
  'companion-arrow-nw': require('../assets/companion/arrow-nw.png'),
};

interface CompanionLayerProps {
  visible: boolean;
  position: LatLng | null;
  sprite: SpriteOrIdle;
}

export function CompanionLayer({
  visible,
  position,
  sprite,
}: CompanionLayerProps): JSX.Element | null {
  // Idle falls back to the south-facing arrow (dog "looks at viewer").
  const spriteImageId = `companion-arrow-${sprite === 'idle' ? 's' : sprite}`;

  const shape = useMemo<Feature<Point> | null>(() => {
    if (!visible || !position) return null;
    return {
      type: 'Feature',
      properties: { sprite: spriteImageId },
      geometry: {
        type: 'Point',
        coordinates: [position.longitude, position.latitude],
      },
    };
  }, [visible, position, spriteImageId]);

  if (!shape) return null;

  return (
    <>
      <MapboxGL.Images images={SPRITE_IMAGES} />
      <MapboxGL.ShapeSource id="companion-source" shape={shape}>
        <MapboxGL.SymbolLayer
          id="companion-layer"
          style={{
            iconImage: ['get', 'sprite'],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconSize: [
              'interpolate',
              ['linear'],
              ['zoom'],
              14,
              0.4,
              17,
              1.0,
              20,
              1.6,
            ],
          }}
        />
      </MapboxGL.ShapeSource>
    </>
  );
}
