module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        test: /src\/db\/models\/.*\.ts$/,
        plugins: [
          ['@babel/plugin-transform-typescript', { allowDeclareFields: true, allowNamespaces: true }],
        ],
      },
    ],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      'react-native-reanimated/plugin',
    ],
  };
};
