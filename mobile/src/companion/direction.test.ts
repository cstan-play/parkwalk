import {
  screenBearing,
  snapToSprite,
  type SnapParams,
  type SpriteDirection,
  type SpriteOrIdle,
} from './direction';

const PARAMS: SnapParams = { hysteresisDeg: 5, idleSpeedMps: 0.3 };

describe('screenBearing', () => {
  test('north-moving velocity with bearing 0 → screen bearing 0', () => {
    expect(screenBearing({ east: 0, north: 1 }, 0)).toBeCloseTo(0, 5);
  });

  test('east-moving velocity with bearing 0 → screen bearing 90', () => {
    expect(screenBearing({ east: 1, north: 0 }, 0)).toBeCloseTo(90, 5);
  });

  test('south-moving velocity with bearing 0 → screen bearing 180', () => {
    expect(screenBearing({ east: 0, north: -1 }, 0)).toBeCloseTo(180, 5);
  });

  test('west-moving velocity with bearing 0 → screen bearing 270', () => {
    expect(screenBearing({ east: -1, north: 0 }, 0)).toBeCloseTo(270, 5);
  });

  test('camera rotated 90° clockwise: dog moving world-north appears to move screen-west', () => {
    // The camera's "up" now faces world-east. World-north motion is on the
    // left side of the screen → screen bearing = 270.
    expect(screenBearing({ east: 0, north: 1 }, 90)).toBeCloseTo(270, 5);
  });

  test('camera rotated 180°: dog moving world-north appears to move screen-south', () => {
    expect(screenBearing({ east: 0, north: 1 }, 180)).toBeCloseTo(180, 5);
  });

  test('returns a value in [0, 360)', () => {
    for (let bearing = -720; bearing <= 720; bearing += 17) {
      const v = screenBearing({ east: Math.sin(bearing), north: Math.cos(bearing) }, bearing);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });
});

describe('snapToSprite — basic 8-way mapping', () => {
  const cases: ReadonlyArray<readonly [number, SpriteDirection]> = [
    [0, 'n'],
    [45, 'ne'],
    [90, 'e'],
    [135, 'se'],
    [180, 's'],
    [225, 'sw'],
    [270, 'w'],
    [315, 'nw'],
  ];
  test.each(cases)('bearing %d° → sprite %s', (bearing, expected) => {
    expect(snapToSprite(bearing, 1, 'idle', PARAMS)).toBe(expected);
  });

  test('bearing wraps: 360° → n', () => {
    expect(snapToSprite(360, 1, 'idle', PARAMS)).toBe('n');
  });

  test('negative bearings normalize: -45° → nw', () => {
    expect(snapToSprite(-45, 1, 'idle', PARAMS)).toBe('nw');
  });
});

describe('snapToSprite — idle gating', () => {
  test('below idleSpeedMps with no prior sprite returns idle', () => {
    expect(snapToSprite(0, 0.1, 'idle', PARAMS)).toBe('idle');
  });

  test('below idleSpeedMps holds the previous sprite (no flicker on stop)', () => {
    expect(snapToSprite(0, 0.1, 'e', PARAMS)).toBe('e');
  });

  test('at exactly idleSpeedMps treats as idle (gate is strict <)', () => {
    expect(snapToSprite(180, PARAMS.idleSpeedMps, 'idle', PARAMS)).toBe('s');
  });
});

describe('snapToSprite — hysteresis at boundaries', () => {
  // Boundary between 'n' (centered at 0°) and 'ne' (centered at 45°) is 22.5°.
  // With hysteresisDeg = 5, the dog must be at least 27.5° from 'n' to leave 'n'.

  test('inside hysteresis margin holds the previous sprite', () => {
    // 25° is past the naive 22.5° boundary but inside the 27.5° hysteresis margin.
    expect(snapToSprite(25, 1, 'n', PARAMS)).toBe('n');
  });

  test('outside hysteresis margin switches to the new sprite', () => {
    // 30° is past 27.5° → must switch to 'ne'.
    expect(snapToSprite(30, 1, 'n', PARAMS)).toBe('ne');
  });

  test('hysteresis is symmetric — 340° (i.e., -20° from N) holds n', () => {
    expect(snapToSprite(340, 1, 'n', PARAMS)).toBe('n');
  });

  test('hysteresis allows full sweep without skipping sprites', () => {
    // Sweep from 0° to 360° in 1° increments. The sprite sequence should
    // cover all 8 directions in order without skips or backtracks.
    let previous: SpriteOrIdle = 'n';
    const seen: SpriteDirection[] = ['n'];
    for (let bearing = 1; bearing <= 360; bearing += 1) {
      const next = snapToSprite(bearing, 1, previous, PARAMS);
      if (next !== 'idle' && next !== previous) {
        seen.push(next);
        previous = next;
      }
    }
    expect(seen).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'n']);
  });

  test('jitter exactly on a boundary does not flicker', () => {
    // Bearing oscillates ±2° around the 22.5° n/ne boundary. With
    // hysteresisDeg = 5 the sprite must hold whichever it started on.
    let sprite: SpriteOrIdle = 'n';
    let switches = 0;
    for (let i = 0; i < 200; i++) {
      const bearing = 22.5 + (i % 2 === 0 ? -2 : 2);
      const next = snapToSprite(bearing, 1, sprite, PARAMS);
      if (next !== sprite) switches++;
      sprite = next;
    }
    expect(switches).toBe(0);
  });
});
