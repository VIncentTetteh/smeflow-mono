import '@expo/metro-runtime';

import React from 'react';
import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import { ctx } from 'expo-router/_ctx';

function App() {
  return React.createElement(ExpoRoot, { context: ctx });
}

registerRootComponent(App);
