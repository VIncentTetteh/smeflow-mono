# KYC Separation — User vs Business Design

**Date:** 2026-06-07
**Status:** Approved

---

## Problem

The onboarding KYC screen sends the same fields (Ghana Card, TIN) to both the User KYC endpoint and the Business KYC endpoint. This is wrong:

- User KYC verifies the **person** — only the Ghana Card ID belongs here
- Business KYC verifies the **business entity** — Business Registration Number and TIN belong here
- Users adding a second business are shown a Ghana Card field they already submitted, with a silent 409 workaround hiding the duplication

---

## Goal

Send the right fields to the right endpoint. Single screen, conditional display based on whether the user's personal identity is already verified.

---

## Field Mapping

| Field | Endpoint | Required |
|---|---|---|
| Ghana Card Number | User KYC `/api/v1/auth/kyc` | Yes (if user not verified) |
| Business Registration Number | Business KYC `/api/v1/kyc` | Yes |
| TIN | Business KYC `/api/v1/kyc` | No |

---

## Screen Behaviour (`mobile/app/(auth)/onboarding/kyc.tsx`)

Reads `user.kyc_status` from the auth store (available after login on `UserResponseDto`).

| User KYC status | Ghana Card field | Business Reg No. field | TIN field |
|---|---|---|---|
| `unverified` / `rejected` / `pending` | Shown, required | Shown, required | Shown, optional |
| `verified` | Hidden | Shown, required | Shown, optional |

**Submit logic:**
1. If user not verified → call `submitUserKyc({ ghana_card_id })`, then call `submitBusinessKyc({ business_registration_ref, tin? })`
2. If user already verified → call `submitBusinessKyc({ business_registration_ref, tin? })` only

The existing 409 catch workaround on `submitUserKyc` is removed — replaced by the upfront status check.

**Validation:**
- Ghana Card: format `GHA-XXXXXXXXX-X` (existing regex, unchanged)
- Business Registration Number: non-empty string
- TIN: 11 digits if provided (existing regex, unchanged) — moves from User KYC to Business KYC context

---

## Type Changes

**Mobile `mobile/src/types/auth.ts` — `UserKYCSubmitDto`:**
```ts
// Before
export interface UserKYCSubmitDto {
  ghana_card_id?: string;
  tin?: string;
}

// After
export interface UserKYCSubmitDto {
  ghana_card_id: string;
}
```

**Mobile `mobile/src/types/kyc.ts` — `BusinessKYCSubmitDto`:**
```ts
// Before
export interface BusinessKYCSubmitDto {
  ghana_card_id?: string;
  tin?: string;
  business_registration_ref?: string;
  documents?: object;
}

// After
export interface BusinessKYCSubmitDto {
  business_registration_ref: string;
  tin?: string;
  documents?: object;
}
```

---

## Backend Changes (`api/`)

**`api/apps/api/modules/auth/schemas.py` — `KYCSubmitRequest`:**
```python
# Before
class KYCSubmitRequest(BaseModel):
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)

# After
class KYCSubmitRequest(BaseModel):
    ghana_card_id: str = Field(..., pattern=GHANA_CARD_PATTERN)
```

**`api/apps/api/modules/kyc/schemas.py` — `KYCSubmit`:**
```python
# Before
class KYCSubmit(BaseModel):
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)
    business_registration_ref: str | None = Field(None, max_length=100)

# After
class KYCSubmit(BaseModel):
    business_registration_ref: str = Field(..., max_length=100)
    tin: str | None = Field(None, pattern=TIN_PATTERN)
```

Tests in `api/apps/api/tests/` that cover KYC submissions must be updated to match the new required fields.

---

## Out of Scope

- `kyc-status.tsx` — no changes needed, already shows both statuses correctly
- Document upload flow — `documents` field stays as-is (empty array for now)
- KYC re-verification flow — same screen is reused, same conditional logic applies
