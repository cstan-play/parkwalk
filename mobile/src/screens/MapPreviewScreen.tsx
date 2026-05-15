import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { colors } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MapPreview'>;

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const FRAME_WIDTH = 402;
const FRAME_HEIGHT = 874;

export function MapPreviewScreen({ navigation }: Props): JSX.Element {
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
        <View style={styles.mapClip} pointerEvents="none">
          <Image
            source={require('../assets/onboarding/map-preview.png')}
            style={styles.mapImage}
            resizeMode="stretch"
            accessibilityIgnoresInvertColors
          />
        </View>

        <View style={styles.topBand} pointerEvents="none" />
        <View style={styles.bottomBand} pointerEvents="none" />

        <Text style={styles.appName} numberOfLines={1}>
          My PetDog
        </Text>

        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <FigmaArrow direction="back" size={36} color={colors.button.text} />
        </Pressable>

        <View style={styles.bubbleShadow} pointerEvents="none" />
        <View style={styles.bubble}>
          <Text style={styles.bubbleHeadline}>Found us.</Text>
          <Text style={styles.bubbleBody}>
            You live in a nice spot. <Text style={styles.bold}>Lots of corners.</Text>
          </Text>
        </View>

        <Image
          source={require('../assets/onboarding/gus-map-preview.png')}
          style={styles.gus}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />

        <View style={styles.buttonShadow}>
          <Pressable
            onPress={() => navigation.navigate('NudgeChat')}
            accessibilityRole="button"
            accessibilityLabel="What now?"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>What now?</Text>
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
    overflow: 'hidden',
  },
  frame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  mapClip: {
    position: 'absolute',
    top: 0,
    left: -149,
    width: 716,
    height: 874,
    overflow: 'hidden',
  },
  mapImage: {
    position: 'absolute',
    top: -229,
    left: 0,
    width: 716,
    height: 1552,
  },
  topBand: {
    position: 'absolute',
    top: -30,
    left: -11,
    width: 424,
    height: 199,
    borderBottomLeftRadius: 58,
    borderBottomRightRadius: 58,
    backgroundColor: colors.background,
  },
  bottomBand: {
    position: 'absolute',
    top: 717,
    left: 0,
    width: 402,
    height: 187,
    borderTopLeftRadius: 62,
    borderTopRightRadius: 62,
    backgroundColor: colors.background,
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
    top: 97,
    left: 169,
    width: 65,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: colors.button.solid,
    backgroundColor: colors.button.solid,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 7,
    elevation: 5,
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
  bubbleShadow: {
    position: 'absolute',
    top: 504,
    left: 20,
    width: 235,
    height: 120,
    borderTopRightRadius: 39,
    borderBottomLeftRadius: 39,
    borderBottomRightRadius: 39,
    backgroundColor: '#c7ab8e',
    opacity: 0.55,
  },
  bubble: {
    position: 'absolute',
    top: 494,
    left: 24,
    width: 231,
    height: 120,
    borderTopRightRadius: 39,
    borderBottomLeftRadius: 39,
    borderBottomRightRadius: 39,
    backgroundColor: '#f0e4d4',
    paddingLeft: 27,
    paddingTop: 14,
  },
  bubbleHeadline: {
    color: colors.text,
    fontFamily: SERIF,
    fontSize: 40.4,
    lineHeight: 39,
  },
  bubbleBody: {
    width: 172,
    marginTop: 4,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
  },
  gus: {
    position: 'absolute',
    top: 523,
    left: 255,
    width: 132,
    height: 279,
  },
  buttonShadow: {
    position: 'absolute',
    top: 724,
    left: 40,
    width: 218,
    height: 82,
    borderRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 7,
  },
  button: {
    width: 218,
    height: 74,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.button.border,
    backgroundColor: colors.button.solid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
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
    marginLeft: 10,
    marginTop: -3,
  },
  buttonArrowIcon: {
    marginLeft: 10,
  },
});
