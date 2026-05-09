import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToChat(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Chat');
  }
}
