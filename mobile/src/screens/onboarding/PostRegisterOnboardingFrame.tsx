import React, { useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import { colors } from '@/theme';

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const FRAME_WIDTH = 402;
const FRAME_HEIGHT = 874;
const BACK_SIZE = 65;
const BUTTON_HEIGHT = 74;

interface Props {
  hero: ImageSourcePropType;
  heroWidth: number;
  heroHeight: number;
  heroTop: number;
  heroCenterOffset?: number;
  headline: string;
  headlineTop: number;
  headlineWidth: number;
  body: React.ReactNode;
  bodyTop: number;
  bodyWidth: number;
  buttonLabel: string;
  buttonWidth: number;
  buttonTop?: number;
  buttonBottom?: number;
  buttonCenterOffset?: number;
  onPressBack: () => void;
  onPressContinue: () => void;
}

export function PostRegisterOnboardingFrame({
  hero,
  heroWidth,
  heroHeight,
  heroTop,
  heroCenterOffset = 0,
  headline,
  headlineTop,
  headlineWidth,
  body,
  bodyTop,
  bodyWidth,
  buttonLabel,
  buttonWidth,
  buttonTop,
  buttonBottom = 44,
  buttonCenterOffset = 0,
  onPressBack,
  onPressContinue,
}: Props): JSX.Element {
  const insets = useSafeAreaInsets();
  const [frameScale, setFrameScale] = useState(1);

  function handleLayout(event: LayoutChangeEvent): void {
    const { width, height } = event.nativeEvent.layout;
    const nextScale = Math.min(1, width / FRAME_WIDTH, height / FRAME_HEIGHT);
    setFrameScale(nextScale);
  }

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      onLayout={handleLayout}
    >
      <View
        style={[
          styles.scaledViewport,
          { width: FRAME_WIDTH * frameScale, height: FRAME_HEIGHT * frameScale },
        ]}
      >
      <View style={[styles.frame, { transform: [{ scale: frameScale }] }]}>
        <Pressable
          onPress={onPressBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <FigmaArrow direction="back" size={36} color={colors.button.text} />
        </Pressable>

        <Text style={styles.appName} numberOfLines={1}>
          My PetDog
        </Text>

        <View
          style={[
            styles.heroBox,
            {
              top: heroTop,
              width: heroWidth,
              height: heroHeight,
              marginLeft: -heroWidth / 2 + heroCenterOffset,
            },
          ]}
        >
          <Image
            source={hero}
            style={styles.hero}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>

        <Text
          style={[
            styles.headline,
            {
              top: headlineTop,
              width: headlineWidth,
              marginLeft: -headlineWidth / 2,
            },
          ]}
        >
          {headline}
        </Text>

        <Text
          style={[
            styles.body,
            {
              top: bodyTop,
              width: bodyWidth,
              marginLeft: -bodyWidth / 2,
            },
          ]}
        >
          {body}
        </Text>

        <View
          style={[
            styles.buttonShadow,
            {
              width: buttonWidth,
              marginLeft: -buttonWidth / 2 + buttonCenterOffset,
              ...(buttonTop === undefined ? { bottom: buttonBottom } : { top: buttonTop }),
            },
          ]}
        >
          <Pressable
            onPress={onPressContinue}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{buttonLabel}</Text>
            <FigmaArrow size={32} color={colors.button.text} style={styles.buttonArrowIcon} />
          </Pressable>
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  scaledViewport: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  frame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    position: 'relative',
  },
  appName: {
    position: 'absolute',
    top: 57,
    left: 147,
    color: colors.appName,
    fontSize: 20,
    fontWeight: '900',
  },
  backButton: {
    position: 'absolute',
    top: 36,
    left: 32,
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.button.solid,
    backgroundColor: colors.button.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.96 }],
  },
  backGlyph: {
    color: colors.button.text,
    fontSize: 35,
    fontWeight: '700',
    lineHeight: 38,
    marginTop: -3,
  },
  heroBox: {
    position: 'absolute',
    left: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hero: {
    width: '100%',
    height: '100%',
  },
  headline: {
    position: 'absolute',
    left: '50%',
    color: colors.text,
    fontFamily: SERIF,
    fontSize: 38,
    lineHeight: 38,
    textAlign: 'center',
  },
  body: {
    position: 'absolute',
    left: '50%',
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  bodyBold: {
    fontWeight: '700',
  },
  buttonShadow: {
    position: 'absolute',
    left: '50%',
    height: BUTTON_HEIGHT,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 7,
  },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.button.border,
    backgroundColor: colors.button.solid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonPressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: colors.button.text,
    fontSize: 24.8,
    fontWeight: '600',
  },
  buttonArrow: {
    color: colors.button.text,
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 36,
    marginLeft: 12,
    marginTop: -3,
  },
  buttonArrowIcon: {
    marginLeft: 12,
  },
});

export const postRegisterTextStyles = StyleSheet.create({
  bold: {
    fontWeight: '700',
  },
});
