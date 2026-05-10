import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';

import App from './App';
import { name as appName } from './app.json';
import { registerGusBackgroundNotificationHandler } from './src/notifications/handler';

// Notifee Android requires onBackgroundEvent to be registered before
// AppRegistry.registerComponent. See handler.ts for details.
registerGusBackgroundNotificationHandler();

AppRegistry.registerComponent(appName, () => App);
