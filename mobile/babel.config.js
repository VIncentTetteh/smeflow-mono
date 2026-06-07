module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // allowDeclareFields prevents TypeScript from emitting `this.field = undefined`
    // initializers for WatermelonDB model files. Without it, those initializers call
    // the @field setter outside of _isEditing=true, triggering a WatermelonDB invariant.
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
