/**
 * Renders the digital companion onto the Mapbox view.
 *
 * The companion sprite is a 4-frame walk-cycle dog facing one of 8
 * directions, plus an idle pose. Frames are pre-extracted from per-
 * direction GIFs by `mobile/src/assets/companion/_extract_dog_frames.py`
 * into PNGs named `dog-<dir>-<frame>.png`.
 *
 * Animation strategy: a single feature on a SymbolLayer whose `sprite`
 * property selects the active image. A render-side frame counter ticks
 * every FRAME_INTERVAL_MS while the dog is moving, and is held at frame
 * 0 while idle. Each tick mutates `sprite`, which causes Mapbox to swap
 * the image. This keeps everything inside the existing sprite pipeline —
 * no MarkerView / GIF runtime, no platform-specific rendering paths.
 *
 * Placement order in the parent must keep this layer ABOVE the active-walk
 * route (so it visually sits on the map) but BELOW collectible markers
 * (so a companion sprite never occludes a tappable marker).
 */

import MapboxGL from '@rnmapbox/maps';
import type { Feature, Point } from 'geojson';
import React, { useEffect, useMemo, useState } from 'react';

import type { SpriteOrIdle } from '@/companion/direction';
import type { LatLng } from '@/util/geo';

const FRAME_COUNT = 4;
const FRAME_INTERVAL_MS = 125; // 8 fps walk cycle

// Relative paths (not the `@/` alias) — Metro's asset plugin reads the
// require argument as a literal path and does not run it through Babel's
// module-resolver. Aliased asset requires return undefined at runtime,
// which then crashes the native Mapbox SymbolLayer.
const SPRITE_IMAGES = {
  'companion-dog-n-0': require('../assets/companion/dog-n-0.png'),
  'companion-dog-n-1': require('../assets/companion/dog-n-1.png'),
  'companion-dog-n-2': require('../assets/companion/dog-n-2.png'),
  'companion-dog-n-3': require('../assets/companion/dog-n-3.png'),
  'companion-dog-ne-0': require('../assets/companion/dog-ne-0.png'),
  'companion-dog-ne-1': require('../assets/companion/dog-ne-1.png'),
  'companion-dog-ne-2': require('../assets/companion/dog-ne-2.png'),
  'companion-dog-ne-3': require('../assets/companion/dog-ne-3.png'),
  'companion-dog-e-0': require('../assets/companion/dog-e-0.png'),
  'companion-dog-e-1': require('../assets/companion/dog-e-1.png'),
  'companion-dog-e-2': require('../assets/companion/dog-e-2.png'),
  'companion-dog-e-3': require('../assets/companion/dog-e-3.png'),
  'companion-dog-se-0': require('../assets/companion/dog-se-0.png'),
  'companion-dog-se-1': require('../assets/companion/dog-se-1.png'),
  'companion-dog-se-2': require('../assets/companion/dog-se-2.png'),
  'companion-dog-se-3': require('../assets/companion/dog-se-3.png'),
  'companion-dog-s-0': require('../assets/companion/dog-s-0.png'),
  'companion-dog-s-1': require('../assets/companion/dog-s-1.png'),
  'companion-dog-s-2': require('../assets/companion/dog-s-2.png'),
  'companion-dog-s-3': require('../assets/companion/dog-s-3.png'),
  'companion-dog-sw-0': require('../assets/companion/dog-sw-0.png'),
  'companion-dog-sw-1': require('../assets/companion/dog-sw-1.png'),
  'companion-dog-sw-2': require('../assets/companion/dog-sw-2.png'),
  'companion-dog-sw-3': require('../assets/companion/dog-sw-3.png'),
  'companion-dog-w-0': require('../assets/companion/dog-w-0.png'),
  'companion-dog-w-1': require('../assets/companion/dog-w-1.png'),
  'companion-dog-w-2': require('../assets/companion/dog-w-2.png'),
  'companion-dog-w-3': require('../assets/companion/dog-w-3.png'),
  'companion-dog-nw-0': require('../assets/companion/dog-nw-0.png'),
  'companion-dog-nw-1': require('../assets/companion/dog-nw-1.png'),
  'companion-dog-nw-2': require('../assets/companion/dog-nw-2.png'),
  'companion-dog-nw-3': require('../assets/companion/dog-nw-3.png'),
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
  // Frame counter ticks while the dog is walking; held at 0 when idle.
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (sprite === 'idle') {
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAME_COUNT);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sprite]);

  // Idle falls back to the south-facing pose ("dog looks at viewer"),
  // held on frame 0 (no walk cycle) so the dog reads as standing still.
  const direction = sprite === 'idle' ? 's' : sprite;
  const activeFrame = sprite === 'idle' ? 0 : frame;
  const spriteImageId = `companion-dog-${direction}-${activeFrame}`;

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
