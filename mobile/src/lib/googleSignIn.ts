import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';

let configured = false;

export class GoogleSignInCancelledError extends Error {}

export class GoogleSignInUnavailableError extends Error {}

/**
 * Lazily requires the native module. Must NOT be imported at the top of this
 * file (or any file that imports this one) — the package resolves its
 * TurboModule at require-time, which throws immediately on any dev
 * client/Expo Go build that doesn't have RNGoogleSignin compiled in yet.
 * Deferring the require here means only an actual sign-in attempt fails,
 * not every screen that merely imports the Google Sign-In button.
 */
function loadNativeModule(): typeof GoogleSigninModule {
  try {
    return require('@react-native-google-signin/google-signin');
  } catch {
    throw new GoogleSignInUnavailableError(
      "Google Sign-In isn't available in this build yet. Use your phone number or email instead."
    );
  }
}

function ensureConfigured(): typeof GoogleSigninModule {
  const mod = loadNativeModule();
  if (!configured) {
    const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;
    mod.GoogleSignin.configure({
      iosClientId,
      // webClientId is required to obtain an idToken that our backend can verify,
      // even on Android — see the library's docs on server-side auth.
      webClientId,
      offlineAccess: false,
    });
    configured = true;
  }
  return mod;
}

/** Opens the native Google account picker and returns the id_token to send to the backend. */
export async function signInWithGoogle(): Promise<string> {
  const { GoogleSignin, isSuccessResponse } = ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new GoogleSignInCancelledError('Google sign-in was cancelled');
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google did not return an id token');
  }
  return idToken;
}
