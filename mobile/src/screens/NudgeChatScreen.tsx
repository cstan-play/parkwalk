import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Text } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useNotificationPermission } from '@/notifications/permissions';
import { rescheduleAllGusNotifications } from '@/notifications/scheduler';
import {
  PostRegisterOnboardingFrame,
  postRegisterTextStyles,
} from '@/screens/onboarding/PostRegisterOnboardingFrame';

type Props = NativeStackScreenProps<RootStackParamList, 'NudgeChat'>;

export function NudgeChatScreen({ navigation }: Props): JSX.Element {
  const notifications = useNotificationPermission();
  const [requesting, setRequesting] = useState(false);

  async function continueToAllSet(): Promise<void> {
    if (requesting) return;
    setRequesting(true);
    try {
      if (!notifications.loading && notifications.status === 'unknown') {
        await notifications.request();
      }
      await rescheduleAllGusNotifications();
      navigation.navigate('AllSet');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <PostRegisterOnboardingFrame
      hero={require('../assets/onboarding/gus-chat.png')}
      heroWidth={357}
      heroHeight={420}
      heroTop={102}
      heroCenterOffset={10.5}
      headline={'One more\nthing... or two'}
      headlineTop={530}
      headlineWidth={300}
      body={
        <>
          Can I <Text style={postRegisterTextStyles.bold}>nudge you?</Text> Nothing constant.
          Just a little wave from the lock screen. Also,{' '}
          <Text style={postRegisterTextStyles.bold}>if you ever wanna chat</Text>, I am right here.
        </>
      }
      bodyTop={624}
      bodyWidth={289}
      buttonLabel="Noted"
      buttonWidth={179}
      buttonCenterOffset={10.5}
      onPressBack={() => navigation.goBack()}
      onPressContinue={() => void continueToAllSet()}
    />
  );
}
