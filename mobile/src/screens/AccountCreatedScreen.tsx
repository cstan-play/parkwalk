import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import {
  PostRegisterOnboardingFrame,
  postRegisterTextStyles,
} from '@/screens/onboarding/PostRegisterOnboardingFrame';
import { useAuthStore } from '@/stores/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'AccountCreated'>;

export function AccountCreatedScreen({ navigation }: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const name = user?.displayName || user?.username || '[Name]';

  return (
    <PostRegisterOnboardingFrame
      hero={require('../assets/onboarding/gus-acc-created.png')}
      heroWidth={301}
      heroHeight={376}
      heroTop={145}
      headline={`Got you, ${name}.`}
      headlineTop={530}
      headlineWidth={300}
      body={
        <>
          <Text style={postRegisterTextStyles.bold}>Suits you.</Text>
          {'\n'}I'll remember. 🐾
        </>
      }
      bodyTop={610}
      bodyWidth={180}
      buttonLabel="Thanks, Gus."
      buttonWidth={248}
      onPressBack={() => navigation.goBack()}
      onPressContinue={() => navigation.navigate('AllowMap')}
    />
  );
}
