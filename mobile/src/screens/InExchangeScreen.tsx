/**
 * Onboarding screen 3 — "In exchange, you get me."
 *
 * Matches Figma node 20:520 ("3. In exchange"). Last screen in the
 * pure-narrative onboarding sequence; tapping "I'm listening" advances
 * to the existing `Onboarding` screen which handles permissions and
 * sign-in / create-account.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { OnboardingScaffold } from '@/screens/onboarding/OnboardingScaffold';
import { textStyles } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'InExchange'>;

export function InExchangeScreen({ navigation }: Props): JSX.Element {
  return (
    <OnboardingScaffold
      hero={require('../assets/onboarding/gus-exchange-hero.png')}
      headlineLines={['In exchange,', 'you get me.']}
      body={
        <>
          <Text style={textStyles.bodyBold}>Mixed reviews so far</Text>, but I’m working on it. 🤷
        </>
      }
      buttonLabel="I’m listening"
      onPressContinue={() => navigation.navigate('Setup')}
      showBackArrow
      onPressBack={() => navigation.goBack()}
    />
  );
}
