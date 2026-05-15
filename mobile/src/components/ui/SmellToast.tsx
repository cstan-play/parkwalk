import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

const DISMISS_AFTER_MS = 2800;
const ANIMATION_MS = 200;

/**
 * Non-blocking transient toast for auto-collect feedback. Renders at the
 * bottom of the screen, fades in, sits briefly, fades out. Multiple
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
      <Text style={styles.text} numberOfLines={3}>
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
    bottom: 326,
    backgroundColor: '#F7EFE5',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#6A3E1B',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  text: {
    color: '#5A1C01',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    textAlign: 'center',
  },
});
