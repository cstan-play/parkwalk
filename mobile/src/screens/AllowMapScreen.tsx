import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { RESULTS, usePermissions } from '@/hooks/usePermissions';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import {
  PostRegisterOnboardingFrame,
  postRegisterTextStyles,
} from '@/screens/onboarding/PostRegisterOnboardingFrame';

type Props = NativeStackScreenProps<RootStackParamList, 'AllowMap'>;

export function AllowMapScreen({ navigation }: Props): JSX.Element {
  const permissions = usePermissions();
  const [requesting, setRequesting] = useState(false);

  async function continueToHome(): Promise<void> {
    setRequesting(true);
    try {
      const granted =
        permissions.location === RESULTS.GRANTED || permissions.location === RESULTS.LIMITED;
      if (!granted) {
        await permissions.request();
      }
      navigation.navigate('MapPreview');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <PostRegisterOnboardingFrame
      hero={require('../assets/onboarding/gus-setup-hero.png')}
      heroWidth={288}
      heroHeight={372}
      heroTop={149}
      headline={'Small admin\nmoment'}
      headlineTop={530}
      headlineWidth={300}
      body={
        <>
          I don't know where we are.{' '}
          <Text style={postRegisterTextStyles.bold}>Map permission, please!</Text> I promise
          I'll only look when we're walking.
        </>
      }
      bodyTop={615}
      bodyWidth={289}
      buttonLabel={requesting ? 'One second...' : 'Show Gus the map'}
      buttonWidth={315}
      onPressBack={() => navigation.goBack()}
      onPressContinue={() => void continueToHome()}
    />
  );
}
