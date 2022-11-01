/**
 * @type {import('@remix-run/dev').AppConfig}
 */
module.exports = {
  appDirectory: 'src',
  ignoredRouteFiles: ['**/.*'],
  serverBuildTarget: 'vercel',
  // When running locally in development mode, we use the built in remix
  // server. This does not understand the vercel lambda module format,
  // so we default back to the standard build output.
  server:
    process.env.NODE_ENV === 'development'
      ? undefined
      : './src/server/vercel.js',

  // From 1.5.0 defaults
  assetsBuildDirectory: 'public/build',
  serverBuildPath: 'api/index.js',
  publicPath: '/build/',
};
