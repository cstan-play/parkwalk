jest.mock('react-native-config', () => ({
  API_BASE_URL: '',
  MAPBOX_ACCESS_TOKEN: 'pk.test',
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(async () => null),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly' },
}));

jest.mock('@rnmapbox/maps', () => ({
  setAccessToken: jest.fn(),
  MapView: () => null,
  Camera: () => null,
  UserLocation: () => null,
  PointAnnotation: () => null,
  UserTrackingMode: { Follow: 'follow' },
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  const SafeAreaInsetsContext = React.createContext(insets);
  const SafeAreaFrameContext = React.createContext(frame);
  return {
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    initialWindowMetrics: { insets, frame },
    SafeAreaProvider: ({ children }) =>
      React.createElement(
        SafeAreaFrameContext.Provider,
        { value: frame },
        React.createElement(SafeAreaInsetsContext.Provider, { value: insets }, children),
      ),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
  };
});

jest.mock('react-native-sensors', () => ({
  accelerometer: { subscribe: () => ({ unsubscribe: jest.fn() }) },
  SensorTypes: { accelerometer: 'accelerometer' },
  setUpdateIntervalForType: jest.fn(),
}));

jest.mock('react-native-geolocation-service', () => ({
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

jest.mock('react-native-permissions', () => ({
  check: jest.fn(async () => 'granted'),
  request: jest.fn(async () => 'granted'),
  PERMISSIONS: { IOS: { LOCATION_ALWAYS: 'LOCATION_ALWAYS', MOTION: 'MOTION' }, ANDROID: { ACCESS_FINE_LOCATION: 'ACCESS_FINE_LOCATION' } },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked', UNAVAILABLE: 'unavailable', LIMITED: 'limited' },
}));
