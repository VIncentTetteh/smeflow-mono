import { getAuthRedirect, getHomeRouteForRole } from '@/navigation/authRouting';

describe('getAuthRedirect', () => {
  it('keeps unauthenticated users on the phone login screen', () => {
    expect(getAuthRedirect({
      isAuthenticated: false,
      hasBusinessContext: false,
      role: null,
      segments: ['(auth)'],
    })).toBeNull();
  });

  it('allows unauthenticated users to enter the OTP screen after requesting a code', () => {
    expect(getAuthRedirect({
      isAuthenticated: false,
      hasBusinessContext: false,
      role: null,
      segments: ['(auth)', 'otp'],
    })).toBeNull();
  });

  it('does not allow unauthenticated users to see business onboarding', () => {
    expect(getAuthRedirect({
      isAuthenticated: false,
      hasBusinessContext: false,
      role: null,
      segments: ['(auth)', 'onboarding', 'business'],
    })).toBe('/');
  });

  it('sends verified users without a business to business onboarding', () => {
    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: false,
      role: null,
      segments: ['(auth)'],
    })).toBe('/onboarding/business');
  });

  it('keeps verified users without a business inside onboarding', () => {
    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: false,
      role: null,
      segments: ['(auth)', 'onboarding', 'business'],
    })).toBeNull();
  });

  it('sends verified users without a business away from owner and agent routes', () => {
    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: false,
      role: null,
      segments: ['owner'],
    })).toBe('/onboarding/business');

    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: false,
      role: null,
      segments: ['agent'],
    })).toBe('/onboarding/business');
  });

  it('sends business users away from auth screens to the right app', () => {
    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: true,
      role: 'agent',
      segments: ['(auth)'],
    })).toBe('/agent');

    expect(getAuthRedirect({
      isAuthenticated: true,
      hasBusinessContext: true,
      role: 'owner',
      segments: ['(auth)', 'otp'],
    })).toBe('/owner');
  });

  it('returns concrete home routes for roles', () => {
    expect(getHomeRouteForRole('agent')).toBe('/agent');
    expect(getHomeRouteForRole('owner')).toBe('/owner');
    expect(getHomeRouteForRole('manager')).toBe('/owner');
    expect(getHomeRouteForRole('staff')).toBe('/owner');
    expect(getHomeRouteForRole('none')).toBe('/owner');
  });
});
