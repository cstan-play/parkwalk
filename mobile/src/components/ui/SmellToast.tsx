import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

const DISMISS_AFTER_MS = 1600;
const ANIMATION_MS = 200;

/**
 * Non-blocking transient toast for auto-collect feedback. Renders at the
 * bottom of the screen, fades in, sits for ~1.6s, fades out. Multiple
 * collects within the dismiss window coalesce — latest wins — because
 * `message` is a single string prop and changes simply restart the timer.
 *
 * Strictly informational: no buttons, no input capture, `pointerEvents`
 * disabled. The caller clears `message` via `onHidden` after the toast
 * has fully faded so the component can unmount cleanly.
 */
export interface SmellToastProps {
  message: string | null;
  onHidden: () => void;
}

export function SmellToast({ message, onHidden }: SmellToastProps): JSX.Element | null {
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep `onHidden` in a ref so callers don't have to memoize it. The effect
  // below depends only on `message`; otherwise an inline arrow on the parent
  // (re-created every render) would restart the dismiss timer on every parent
  // re-render and the toast would never fade out.
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;

  useEffect(() => {
    if (!message) return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.timing(opacity, {
      toValue: 1,
      duration: ANIMATION_MS,
      useNativeDriver: true,
    }).start();
    dismissTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: ANIMATION_MS,
        useNativeDriver: true,
      }).start(() => {
        onHiddenRef.current();
      });
    }, DISMISS_AFTER_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [message, opacity]);

  if (!message) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 180,
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
