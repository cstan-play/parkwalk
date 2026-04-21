jest.mock('react-native-config', () => ({
  API_BASE_URL: 'http://127.0.0.1:3000',
  MAPBOX_ACCESS_TOKEN: 'pk.test',
}));

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
