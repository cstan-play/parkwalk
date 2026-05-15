/**
 * Onboarding screen 2 — "Right. Here's the thing."
 *
 * Matches Figma node 20:504 ("2. I need walks"). Same layout as
 * HiImGusScreen with a back arrow that returns to screen 1.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { OnboardingScaffold } from '@/screens/onboarding/OnboardingScaffold';
import { textStyles } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'INeedWalks'>;

export function INeedWalksScreen({ navigation }: Props): JSX.Element {
  return (
    <OnboardingScaffold
      hero={require('../assets/onboarding/gus-walks-hero.png')}
      headlineLines={['Right.', 'Here’s the thing.']}
      body={
        <>
          <Text style={textStyles.bodyBold}>I need walks.</Text> Not marathons — my legs are
          short. 🐾 A loop around the hood is enough.
        </>
      }
      buttonLabel="Go on!"
      onPressContinue={() => navigation.navigate('InExchange')}
      showBackArrow
      onPressBack={() => navigation.goBack()}
    />
  );
}
