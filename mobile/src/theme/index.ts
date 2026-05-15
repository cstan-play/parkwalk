/**
 * Design tokens derived from the Figma "My PetDog" file. Not a full design
 * system — just the values that are reused across the onboarding flow
 * (`1. Hi, I'm Gus`, `2. I need walks`, etc.) and the first-in-world
 * Home screen.
 *
 * Existing screens (HomeScreen, OnboardingScreen, MapScreen, …) currently
 * have inline equivalents of these tokens; adopting them here is a future
 * cleanup. New onboarding screens should import from here directly.
 */

import { Platform, type TextStyle } from 'react-native';

export const colors = {
  background: '#f4ece1', // warm cream
  appName: '#5a1c01', // deep brown — used for the "My PetDog" header
  text: '#000000',
  textSubtle: '#3c3c3c',
  // Figma button uses a vertical gradient #d1b192 -> #bb8d62. We render
  // a solid mid-tone until react-native-linear-gradient (or SVG) is added.
  // `pressed` is one notch darker for the active-press feedback.
  button: {
    gradientStart: '#d1b192',
    gradientEnd: '#bb8d62',
    solid: '#c69f7a',
    solidPressed: '#a07a55',
    border: '#ffffff',
    text: '#faf6f4',
  },
} as const;

export const spacing = {
  /** 4 */ xs: 4,
  /** 8 */ sm: 8,
  /** 12 */ md: 12,
  /** 16 */ base: 16,
  /** 24 */ lg: 24,
  /** 32 */ xl: 32,
  /** 48 */ xxl: 48,
} as const;

export const radii = {
  button: 32, // pill button radius (matches Figma 31.96)
} as const;

/**
 * Font family fallbacks. Figma uses Instrument Serif (large headings),
 * Poppins (button labels, body) and Inter (app-name header). None are
 * bundled yet; we map to platform defaults that preserve character.
 */
export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  // sans-serif is system default on each platform; leave undefined and
  // RN's Text uses the OS default sans.
  sans: undefined,
} as const;

/**
 * Reusable text styles for the onboarding flow. Numeric values match the
 * Figma frame at 402x874; React Native maps 1pt = 1 Figma px on a
 * baseline iPhone-sized canvas, so these scale naturally with safe areas.
 */
export const textStyles = {
  appName: {
    fontWeight: '900',
    fontSize: 20,
    color: colors.appName,
  } satisfies TextStyle,
  serifHeadline: {
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 46,
    color: colors.text,
    textAlign: 'center',
  } satisfies TextStyle,
  body: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'center',
  } satisfies TextStyle,
  bodyBold: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '700',
  } satisfies TextStyle,
  buttonLabel: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.button.text,
  } satisfies TextStyle,
} as const;
