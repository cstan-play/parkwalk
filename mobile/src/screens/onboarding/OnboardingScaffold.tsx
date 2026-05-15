/**
 * Reusable layout shared by the onboarding screens
 * (`1. Hi, I'm Gus`, `2. I need walks`, `3. In exchange`, …).
 *
 * Every screen has the same skeleton:
 *   - "My PetDog" app-name header (center)
 *   - Optional back arrow (top-left)
 *   - Hero image in a measured middle slot
 *   - Serif headline (single or two lines)
 *   - Body paragraph (regular + bold spans)
 *   - Pill button under the body with active-press feedback
 *
 * Caller supplies the variable bits (`hero`, `headline`, `body`,
 * `buttonLabel`, `onPressContinue`). All tokens come from `@/theme`.
 */

import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  StatusBar,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import { colors, radii, spacing, textStyles } from '@/theme';

export interface OnboardingScaffoldProps {
  hero: ImageSourcePropType;
  headlineLines: readonly string[];
  body: React.ReactNode;
  buttonLabel: string;
  onPressContinue: () => void;
  showBackArrow?: boolean;
  onPressBack?: () => void;
}

const BUTTON_HEIGHT = 74;
const BACK_SIZE = 56;
const CONTENT_MAX_WIDTH = 402;
const MAX_HERO_SIZE = 320;

export function OnboardingScaffold({
  hero,
  headlineLines,
  body,
  buttonLabel,
  onPressContinue,
  showBackArrow = false,
  onPressBack,
}: OnboardingScaffoldProps): JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const contentWidth = Math.min(Math.max(width - spacing.lg * 2, 0), CONTENT_MAX_WIDTH);
  const heroSize = Math.min(contentWidth * 0.95, height * 0.34, MAX_HERO_SIZE);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* Header row: back arrow (optional) on the left, app name centered */}
      <View style={[styles.headerRow, { maxWidth: CONTENT_MAX_WIDTH }]}>
        <View style={styles.headerSide}>
          {showBackArrow ? (
            <Pressable
              onPress={onPressBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backShadow, pressed && styles.backShadowPressed]}
            >
              {({ pressed }) => (
                <View style={[styles.back, pressed && styles.backPressed]}>
                  <FigmaArrow direction="back" size={28} color={colors.button.text} />
                </View>
              )}
            </Pressable>
          ) : null}
        </View>
        <Text style={textStyles.appName} numberOfLines={1}>
          My PetDog
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={[styles.content, { maxWidth: CONTENT_MAX_WIDTH }]}>
        {/* Hero illustration */}
        <View style={[styles.heroWrapper, { width: heroSize, height: heroSize }]}>
          <Image
            source={hero}
            style={styles.hero}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>

        {/* Headline (1 or 2 lines) */}
        <View style={styles.headlineWrapper}>
          {headlineLines.map((line, idx) => (
            <Text key={idx} style={[textStyles.serifHeadline, styles.headlineLine]}>
              {line}
            </Text>
          ))}
        </View>

        {/* Body paragraph */}
        <Text style={[textStyles.body, styles.body]}>{body}</Text>

        {/* Continue button */}
        <View style={styles.buttonWrapper}>
          <Pressable
            onPress={onPressContinue}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            style={({ pressed }) => [styles.buttonShadow, pressed && styles.buttonShadowPressed]}
          >
            {({ pressed }) => (
              <View style={[styles.button, pressed && styles.buttonPressed]}>
                <Text style={[textStyles.buttonLabel, styles.buttonText]}>{buttonLabel}</Text>
                <FigmaArrow size={28} color={colors.button.text} style={styles.buttonArrowIcon} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  headerSide: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backShadow: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  backShadowPressed: {
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
  },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    backgroundColor: colors.button.solid,
    borderWidth: 2,
    borderColor: colors.button.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.95 }],
  },
  backGlyph: {
    color: colors.button.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 28,
    // The Unicode arrow glyph sits slightly low in the font; nudge it up.
    marginTop: -2,
  },
  content: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  heroWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hero: {
    width: '100%',
    height: '100%',
  },
  headlineWrapper: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  headlineLine: {
    width: '100%',
  },
  body: {
    width: '100%',
    marginTop: spacing.base,
    paddingHorizontal: spacing.sm,
  },
  buttonWrapper: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonShadow: {
    borderRadius: radii.button,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonShadowPressed: {
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  button: {
    width: 276,
    maxWidth: '100%',
    height: BUTTON_HEIGHT,
    borderRadius: radii.button,
    borderWidth: 2,
    borderColor: colors.button.border,
    backgroundColor: colors.button.solid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonPressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.97 }],
  },
  buttonText: {
    color: colors.button.text,
  },
  buttonArrow: {
    color: colors.button.text,
    marginLeft: spacing.md,
  },
  buttonArrowIcon: {
    marginLeft: spacing.md,
  },
});
