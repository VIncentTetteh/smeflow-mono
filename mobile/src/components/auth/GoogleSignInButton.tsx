import { useState } from 'react';
import { googleLogin, linkGoogleAccount } from '@/api/auth.api';
import { normalizeApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { GoogleSignInCancelledError, signInWithGoogle } from '@/lib/googleSignIn';
import type { TokenResponseDto, UserResponseDto } from '@/types/auth';

interface GoogleSignInButtonProps {
  mode: 'login' | 'link';
  label?: string;
  onLoginSuccess?: (data: TokenResponseDto) => void;
  onLinkSuccess?: (user: UserResponseDto) => void;
  /** Login mode only: fired when this Google account isn't linked to any account yet. */
  onNotLinked?: (message: string) => void;
  onError?: (message: string) => void;
}

export function GoogleSignInButton({
  mode,
  label,
  onLoginSuccess,
  onLinkSuccess,
  onNotLinked,
  onError,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handlePress() {
    if (loading) return;
    setLoading(true);
    try {
      const idToken = await signInWithGoogle();
      if (mode === 'login') {
        const data = await googleLogin({ id_token: idToken });
        onLoginSuccess?.(data);
      } else {
        const user = await linkGoogleAccount({ id_token: idToken });
        onLinkSuccess?.(user);
      }
    } catch (err) {
      if (err instanceof GoogleSignInCancelledError) {
        return;
      }
      const normalized = normalizeApiError(err);
      if (mode === 'login' && normalized.status === 404) {
        onNotLinked?.(normalized.message);
      } else {
        onError?.(normalized.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      label={label ?? (mode === 'login' ? 'Continue with Google' : 'Link Google account')}
      loading={loading}
      onPress={handlePress}
      variant="soft"
    />
  );
}
