type Role = 'owner' | 'manager' | 'staff' | 'agent' | 'none' | null;

interface AuthRedirectInput {
  isAuthenticated: boolean;
  hasBusinessContext: boolean;
  role: Role;
  segments: string[];
}

export function getAuthRedirect({
  isAuthenticated,
  hasBusinessContext,
  role,
  segments,
}: AuthRedirectInput): string | null {
  const inAuthGroup = segments[0] === '(auth)';
  const inOnboarding = inAuthGroup && segments[1] === 'onboarding';
  const inProtectedApp = segments[0] === 'owner' || segments[0] === 'agent';

  if (!isAuthenticated) {
    return !inAuthGroup || inOnboarding ? '/' : null;
  }

  if (!hasBusinessContext) {
    if (role === 'agent') {
      return segments[0] === 'agent' ? null : '/agent';
    }
    return inProtectedApp || (inAuthGroup && !inOnboarding)
      ? '/onboarding/business'
      : null;
  }

  if (inAuthGroup && !inOnboarding) {
    return getHomeRouteForRole(role);
  }

  return null;
}

export function getHomeRouteForRole(role: Role): '/agent' | '/owner' {
  return role === 'agent' ? '/agent' : '/owner';
}
