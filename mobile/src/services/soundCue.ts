/**
 * Tiny audio cue used by the auto-collect feedback. Failures (asset
 * missing, audio focus lost, native module not loadable) are no-ops —
 * never throw, never log loudly. The feedback chain is intentionally
 * graceful: haptic + toast still fire even when audio is silent.
 *
 * The bundled WAV at `assets/sounds/smell-found.wav` is a placeholder
 * silent file shipped to keep the build green. Replace it with a
 * royalty-free ~100ms cue (in place, same filename) to enable audible
 * playback. No code changes needed.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Sound = require('react-native-sound');

// Disable mix-with-others on iOS so the cue doesn't fight Apple Music etc.
// react-native-sound's `setCategory` is safe to call before any Sound is
// instantiated.
try {
  Sound.setCategory('Ambient', true);
} catch {
  // No-op when the native module isn't loadable (e.g. running under jest).
}

type SoundInstance = {
  isLoaded: () => boolean;
  setNumberOfLoops: (n: number) => SoundInstance;
  setVolume: (v: number) => SoundInstance;
  stop: (cb?: () => void) => void;
  play: (cb?: (success: boolean) => void) => void;
};

let preloaded: SoundInstance | null = null;
let preloadAttempted = false;

function ensurePreloaded(): void {
  if (preloadAttempted) return;
  preloadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asset = require('../assets/sounds/smell-found.wav');
    preloaded = new Sound(asset, (error: unknown) => {
      if (error) {
        preloaded = null;
      }
    });
  } catch {
    preloaded = null;
  }
}

/**
 * Plays the smell-found cue. No-throw. Returns nothing because there's
 * nothing useful the caller could do if it fails.
 */
export function playSmellFound(): void {
  ensurePreloaded();
  const sound = preloaded;
  if (!sound) return;
  try {
    if (sound.isLoaded()) {
      sound.stop(() => sound.play());
    } else {
      sound.play();
    }
  } catch {
    // Silent fail — see module docstring.
  }
}
