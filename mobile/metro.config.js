const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const nodeModules = path.resolve(__dirname, 'node_modules');

config.projectRoot = __dirname;
config.resolver.nodeModulesPaths = [nodeModules];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.join(nodeModules, 'react'),
  'react-native': path.join(nodeModules, 'react-native'),
  expo: path.join(nodeModules, 'expo'),
  'expo-router': path.join(nodeModules, 'expo-router'),
};

module.exports = config;
