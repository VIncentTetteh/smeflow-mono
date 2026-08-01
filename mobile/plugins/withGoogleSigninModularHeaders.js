const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# @generated withGoogleSigninModularHeaders';

// @react-native-google-signin/google-signin pulls in Google Sign-In's Firebase-adjacent
// pods (GoogleUtilities, RecaptchaInterop, AppCheckCore) as Swift pods, which fail to
// build as static libraries unless they opt into modular headers. This is the fix
// documented by the library for that exact CocoaPods error. Config-plugin (not a direct
// hand-edit of ios/Podfile) because that file is regenerated on every prebuild.
const EXTRA_LINES = [
  MARKER,
  "pod 'GoogleUtilities', :modular_headers => true",
  "pod 'RecaptchaInterop', :modular_headers => true",
  "pod 'AppCheckCore', :modular_headers => true",
];

function withGoogleSigninModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER)) {
        return config;
      }
      const targetMatch = contents.match(/target ['"][^'"]+['"] do/);
      if (!targetMatch) {
        throw new Error('withGoogleSigninModularHeaders: could not find target block in Podfile');
      }
      const insertAt = targetMatch.index + targetMatch[0].length;
      contents =
        contents.slice(0, insertAt) +
        '\n  ' +
        EXTRA_LINES.join('\n  ') +
        contents.slice(insertAt);
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
}

module.exports = withGoogleSigninModularHeaders;
