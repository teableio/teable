module.exports = {
  packagerConfig: {
    appId: 'YourAppID',
    name: 'TeableApp',
    ignore: (file) => {
      const isTsOrMap = (p) => /[^/\\]+\.js\.map$/.test(p) || /[^/\\]+\.ts$/.test(p);
      if (!file) return false;

      if (file.startsWith('/.vite')) {
        return false;
      }

      if (file === '/package.json') {
        return false;
      }

      if (
        file.startsWith('/server') &&
        !isTsOrMap(file) &&
        !file.startsWith('/server/.yarn') &&
        !file.startsWith('/server/apps/nextjs-app/.next/cache')
      ) {
        return false;
      }

      if (file.startsWith('/node_modules') && !isTsOrMap(file)) {
        return false;
      }

      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
    // {
    //   name: '@electron-forge/maker-dmg',
    //   config: {}
    // }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
  ],
};
