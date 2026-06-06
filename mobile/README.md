# SMEflow Mobile

Expo Router mobile app for the SMEflow backend in `../api`.

## Environment

Create `mobile/.env` with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
```

Use the real backend base URL for device testing. On Android emulators, replace `localhost` with the host mapping your environment requires.

## Run

```bash
npm install
npm run start
```

Then open the app in Expo Go, an emulator, or a development build.

## Verify

```bash
npx tsc --noEmit
npm test -- --runInBand --watchman=false
```

## Auth Model

The app uses backend OTP auth:

- `POST /api/v1/auth/otp/request`
- `POST /api/v1/auth/otp/verify`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Access and refresh tokens are persisted through `expo-secure-store`. There is no email/password login or password reset flow. Authenticated phone recovery uses `/api/v1/auth/account-recovery/initiate` and `/api/v1/auth/account-recovery/confirm`.




0551234987 (MTN)

Use that as the customer phone number when creating a MoMo sale intent in sandbox/test mode. Paystack will simulate the charge against this number without hitting a real wallet.

If you need to test other networks, Paystack's sandbox also accepts:

Telecel/Vodafone: 0201234567
AirtelTigo: 0271234567