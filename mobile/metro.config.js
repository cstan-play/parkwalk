const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

/**
 * Metro config that teaches the bundler about the monorepo layout so that
 * `@parkwalk/shared` resolves directly to shared/src/ without needing a
 * pre-build step. See https://reactnative.dev/docs/metro#monorepo
 *
 * The custom resolveRequest handles TypeScript's NodeNext ESM convention
 * where relative imports end in ".js" but the actual source file is ".ts"
 * (e.g. `export * from './schemas/index.js'` resolving to `./schemas/index.ts`).
 * This is standard for the shared package's node-targeted build but Metro's
 * default resolver doesn't strip ".js" when looking for ".ts" siblings.
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
    resolveRequest: (context, moduleName, platform) => {
      const isRelativeJs =
        (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
        moduleName.endsWith('.js');
      if (isRelativeJs) {
        try {
          return context.resolveRequest(context, moduleName, platform);
        } catch (err) {
          return context.resolveRequest(
            context,
            moduleName.slice(0, -3),
            platform,
          );
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
