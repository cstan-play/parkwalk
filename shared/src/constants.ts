/**
 * Domain constants used by the movement validation algorithm and
 * spatial queries. Sourced from `.cursorrules` and `docs/07-MOVEMENT-DETECTION.md`.
 *
 * These MUST be kept in sync between client and server; both sides import
 * from here.
 */

export const MAX_WALKING_SPEED_MPS = 2.5;

// Raised from 20 -> 35 after first-walk telemetry: iOS reports
// horizontalAccuracy in the 15-25 m range in dense urban real-world
// conditions even with `kCLLocationAccuracyBestForNavigation`. Keeping the
// rule at 20 m was starving the movement window; 35 m still catches
// obvious spoofing/drift (GPS_SPOOF sits well above) without discarding
// legitimate walking fixes. See docs/07-MOVEMENT-DETECTION.md.
export const GPS_MAX_ACCURACY_METERS = 35;

export const DEFAULT_COLLECTION_RADIUS_M = 10;

export const TELEPORT_THRESHOLD_M = 50;

export const WALKING_MIN_STEP_RATE_HZ = 1.0;
export const WALKING_MAX_STEP_RATE_HZ = 3.5;

export const GPS_UPDATE_INTERVAL_MS = 1000;
export const GPS_MIN_DISPLACEMENT_M = 1;

export const MOVEMENT_WINDOW_SECONDS = 30;
export const MIN_SAMPLES_FOR_VALIDATION = 5;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const RATE_LIMIT_AUTH_PER_MIN = 10;
export const RATE_LIMIT_COLLECT_PER_MIN = 30;
export const RATE_LIMIT_GENERAL_PER_MIN = 120;
