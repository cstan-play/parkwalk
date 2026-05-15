/**
 * Onboarding screen 1 — "Oh, hi. I'm Gus."
 *
 * Matches Figma node 20:493. Pure greeting/welcome — no permission
 * requests, no auth. Tapping "Hello, Gus!" advances to screen 2
 * ("I need walks"). No back arrow on screen 1.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { OnboardingScaffold } from '@/screens/onboarding/OnboardingScaffold';
import { textStyles } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'HiImGus'>;

export function HiImGusScreen({ navigation }: Props): JSX.Element {
  return (
    <OnboardingScaffold
      hero={require('../assets/onboarding/gus-hi-hero.png')}
      headlineLines={['Oh, hi. I’m Gus.']}
      body={
        <>
          The shelter said someone would come eventually. I’d nearly given up.{' '}
          <Text style={textStyles.bodyBold}>No pressure. 🙃</Text>
        </>
      }
      buttonLabel="Hello, Gus!"
      onPressContinue={() => navigation.navigate('INeedWalks')}
    />
  );
}
