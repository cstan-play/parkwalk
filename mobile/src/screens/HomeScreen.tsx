/**
 * First in-world screen — the cream-colored greeting the user sees on cold
 * launch when authenticated. Matches Figma node 44:331 ("1st in-world
 * screen") in design intent: serif headline, time-of-day emoji, Gus quip,
 * hero dog illustration, gradient pill button.
 *
 * The button calls `navigation.replace('Map')` so this screen does not
 * remain in the back stack — it's a daily-entry ritual, not a navigable
 * destination the user can swipe back to.
 *
 * Fonts: the Figma uses Instrument Serif / Inter / Poppins. None are
 * bundled in the app yet. We fall back to system + Georgia for the serif
 * to keep the character close without adding a font-loading dependency.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import { RESULTS, usePermissions } from '@/hooks/usePermissions';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useNotificationPermission } from '@/notifications/permissions';
import { rescheduleAllGusNotifications } from '@/notifications/scheduler';
import { pickHomeGreeting } from '@/screens/home/messages';
import { useWeatherStore } from '@/stores/weatherStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const COLORS = {
  background: '#f4ece1',
  appName: '#5a1c01',
  text: '#000000',
  // Figma uses a vertical gradient #d1b192 -> #bb8d62 on the button.
  // Approximated with a single tone close to the gradient midpoint until
  // react-native-linear-gradient is added as a follow-up polish.
  buttonBg: '#c69f7a',
  buttonText: '#faf6f4',
  buttonBorder: '#ffffff',
} as const;

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export function HomeScreen({ navigation }: Props): JSX.Element {
  const insets = useSafeAreaInsets();

  const weatherCode = useWeatherStore((s) => s.raw?.weather_code ?? null);
  const refreshWeather = useWeatherStore((s) => s.refresh);
  useEffect(() => {
    void refreshWeather();
  }, [refreshWeather]);

  // Re-pick when weather lands so the screen swaps from the time-of-day
  // emoji/quip to a weather-flavored one. Stable for a given (cold launch
  // + weatherCode) pair so the quip doesn't churn while the user reads.
  const greeting = useMemo(() => pickHomeGreeting(new Date(), Math.random, weatherCode), [weatherCode]);

  // Restore the permission prompts that previously lived in OnboardingScreen.
  // The new onboarding flow (HiImGus → ... → Setup → Register → Home) skips
  // that screen, so without this the Map can't read location, the companion
  // can't appear, walks can't start, etc. The OS shows its native dialog the
  // first time; subsequent renders are no-ops.
  const permissions = usePermissions();
  const notif = useNotificationPermission();
  const notificationsScheduledRef = useRef(false);

  useEffect(() => {
    if (permissions.loading) return;
    const granted =
      permissions.location === RESULTS.GRANTED || permissions.location === RESULTS.LIMITED;
    if (!granted) {
      void permissions.request();
    }
  }, [permissions.loading, permissions.location]);

  useEffect(() => {
    if (notif.loading) return;
    if (notif.status === 'unknown') {
      void notif.request();
    }
  }, [notif.loading, notif.status]);

  useEffect(() => {
    if (notif.loading || notificationsScheduledRef.current) return;
    if (notif.status === 'authorized' || notif.status === 'provisional') {
      notificationsScheduledRef.current = true;
      void rescheduleAllGusNotifications();
    }
  }, [notif.loading, notif.status]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text style={styles.appName}>My PetDog</Text>

      <Text style={styles.emoji} accessibilityRole="image" accessibilityLabel="weather emoji">
        {greeting.emoji}
      </Text>
      <Text style={styles.headline}>{greeting.headline}</Text>
      <Text style={styles.quip}>{greeting.quip}</Text>

      <View style={styles.heroWrapper}>
        <Image
          source={require('../assets/home/dog-hero.png')}
          style={styles.hero}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>

      <View style={[styles.buttonWrapper, { paddingBottom: insets.bottom + 32 }]}>
        <Pressable
          onPress={() => navigation.replace('Map')}
          style={({ pressed }) => [
            styles.buttonShadow,
            pressed && styles.buttonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={greeting.buttonLabel}
        >
          <View style={styles.button}>
            <Text style={styles.buttonText}>{greeting.buttonLabel}</Text>
            <FigmaArrow size={29} color={COLORS.buttonText} style={styles.buttonArrowIcon} />
          </View>
        </Pressable>
        <Text style={styles.subtext}>I'll take you to the map.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  appName: {
    fontWeight: '900',
    fontSize: 20,
    color: COLORS.appName,
    marginTop: 24,
  },
  emoji: {
    fontSize: 40,
    marginTop: 28,
    lineHeight: 48,
  },
  headline: {
    fontFamily: SERIF,
    fontSize: 38,
    lineHeight: 46,
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 12,
  },
  quip: {
    fontSize: 18,
    lineHeight: 22,
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 32,
  },
  heroWrapper: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 32,
  },
  hero: {
    width: '59%',
    aspectRatio: 248 / 334,
  },
  buttonWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  buttonShadow: {
    width: 276,
    borderRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonPressed: {
    transform: [{ translateY: 1 }],
    shadowOpacity: 0.1,
  },
  button: {
    height: 74,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: COLORS.buttonBorder,
    backgroundColor: COLORS.buttonBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    color: COLORS.buttonText,
    fontSize: 24,
    fontWeight: '600',
  },
  buttonArrow: {
    color: COLORS.buttonText,
    fontSize: 24,
    fontWeight: '600',
    marginLeft: 12,
  },
  buttonArrowIcon: {
    marginLeft: 12,
  },
  subtext: {
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 18,
  },
});
