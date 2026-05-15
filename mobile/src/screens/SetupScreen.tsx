/**
 * Onboarding screen 4 — "Tiny bureaucratic moment."
 *
 * Matches Figma node 20:541 ("4. Setup"). Last screen in the
 * pure-narrative onboarding sequence before account creation; tapping
 * "Set me up" advances to the (redesigned) Register screen.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { OnboardingScaffold } from '@/screens/onboarding/OnboardingScaffold';
import { textStyles } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export function SetupScreen({ navigation }: Props): JSX.Element {
  return (
    <OnboardingScaffold
      hero={require('../assets/onboarding/gus-setup-hero.png')}
      headlineLines={['Tiny bureaucratic moment.']}
      body={
        <>
          <Text style={textStyles.bodyBold}>I’d hate to lose you.</Text> Tell the app who you are
          so we can find each other tomorrow? 📝 I promise it’ll be brief.
        </>
      }
      buttonLabel="Set me up"
      onPressContinue={() => navigation.navigate('Register')}
      showBackArrow
      onPressBack={() => navigation.goBack()}
    />
  );
}
