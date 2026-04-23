/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@parkwalk/shared$': '<rootDir>/../shared/src/index.ts',
    '^@parkwalk/shared/(.*)$': '<rootDir>/../shared/src/$1',
    // Strip TypeScript NodeNext `.js` extension from relative imports so jest
    // can resolve them to their `.ts` source. Mirrors `mobile/metro.config.js`.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@rnmapbox|react-native-sensors|react-native-geolocation-service|react-native-keychain|react-native-permissions|react-native-screens|react-native-gesture-handler|react-native-safe-area-context|@react-navigation)/)',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
