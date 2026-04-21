const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

/**
 * Metro config that teaches the bundler about the monorepo layout so that
 * `@parkwalk/shared` resolves directly to shared/src/ without needing a
 * pre-build step. See https://reactnative.dev/docs/metro#monorepo
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    extraNodeModules: {
      '@parkwalk/shared': path.resolve(workspaceRoot, 'shared/src'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
