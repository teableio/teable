module.exports = function (api) {
  // const isTest = api.env('test');
  // const isDevelopment = api.env('development');
  // const isServer = api.caller((caller) => caller?.isServer);
  // const isCallerDevelopment = api.caller((caller) => caller?.isDev);

  api.cache(true);

  return {
    presets: [['next/babel']],
  };
};
