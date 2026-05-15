import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import {
  PostRegisterOnboardingFrame,
  postRegisterTextStyles,
} from '@/screens/onboarding/PostRegisterOnboardingFrame';
import { useAuthStore } from '@/stores/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'AllSet'>;

export function AllSetScreen({ navigation }: Props): JSX.Element {
  const completePostRegisterOnboarding = useAuthStore((s) => s.completePostRegisterOnboarding);

  function continueToMap(): void {
    completePostRegisterOnboarding();
    navigation.replace('Map');
  }

  return (
    <PostRegisterOnboardingFrame
      hero={require('../assets/onboarding/gus-all-set.png')}
      heroWidth={312}
      heroHeight={346}
      heroTop={174}
      headline="Okay. We're set!"
      headlineTop={530}
      headlineWidth={320}
      body={
        <>
          I have a feeling about a spot just nearby. Don't ask what kind of feeling —{' '}
          <Text style={postRegisterTextStyles.bold}>I'm a dog. 🐾</Text>
        </>
      }
      bodyTop={585}
      bodyWidth={289}
      buttonLabel="Let's go!"
      buttonWidth={204}
      onPressBack={() => navigation.goBack()}
      onPressContinue={continueToMap}
    />
  );
}
