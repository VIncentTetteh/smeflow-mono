# KYC Separation — User vs Business Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send Ghana Card only to User KYC and Business Registration Number + TIN to Business KYC, with the Ghana Card field hidden for already-verified users.

**Architecture:** Backend schemas are tightened first (User KYC accepts only `ghana_card_id` required; Business KYC accepts only `business_registration_ref` required + `tin` optional). Mobile types then mirror these schemas. The onboarding screen reads `user.kyc_status` from the auth store to conditionally show the Ghana Card field and route submissions to the correct endpoints.

**Tech Stack:** Python/FastAPI/Pydantic (backend), TypeScript/React Native/Expo (mobile), pytest (backend tests), Jest (mobile tests)

---

## File Map

| Action | Path |
|---|---|
| Modify | `api/apps/api/modules/auth/schemas.py` |
| Modify | `api/apps/api/modules/kyc/schemas.py` |
| Modify | `api/apps/api/tests/unit/test_kyc_schemas.py` |
| Modify | `mobile/src/types/auth.ts` |
| Modify | `mobile/src/types/kyc.ts` |
| Modify | `mobile/app/(auth)/onboarding/kyc.tsx` |

---

### Task 1: Update backend User KYC schema

**Files:**
- Modify: `api/apps/api/modules/auth/schemas.py`
- Test: `api/apps/api/tests/unit/test_kyc_schemas.py`

- [ ] **Step 1: Write failing tests**

In `api/apps/api/tests/unit/test_kyc_schemas.py`, replace the `TestKYCSubmitRequestGhanaCard` class with:

```python
class TestKYCSubmitRequest:
    def test_valid_ghana_card_accepted(self):
        r = KYCSubmitRequest(ghana_card_id="GHA-123456789-0")
        assert r.ghana_card_id == "GHA-123456789-0"

    def test_ghana_card_required(self):
        with pytest.raises(ValidationError) as exc:
            KYCSubmitRequest()
        errors = exc.value.errors()
        assert any(e["loc"] == ("ghana_card_id",) for e in errors)

    def test_ghana_card_8_digits_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmitRequest(ghana_card_id="GHA-12345678-0")

    def test_ghana_card_letters_in_digits_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmitRequest(ghana_card_id="GHA-12345678A-0")

    def test_tin_field_not_accepted(self):
        # TIN no longer belongs on User KYC — extra fields should be ignored or rejected
        r = KYCSubmitRequest(ghana_card_id="GHA-123456789-0")
        assert not hasattr(r, "tin") or r.model_fields.get("tin") is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd api && python -m pytest apps/api/tests/unit/test_kyc_schemas.py::TestKYCSubmitRequest -v 2>&1 | tail -20
```

Expected: FAIL — `test_ghana_card_required` fails because `ghana_card_id` is currently optional.

- [ ] **Step 3: Update `KYCSubmitRequest` in `api/apps/api/modules/auth/schemas.py`**

Find and replace the `KYCSubmitRequest` class (currently around line 84):

```python
# BEFORE:
class KYCSubmitRequest(BaseModel):
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)

# AFTER:
class KYCSubmitRequest(BaseModel):
    ghana_card_id: str = Field(..., pattern=GHANA_CARD_PATTERN)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd api && python -m pytest apps/api/tests/unit/test_kyc_schemas.py::TestKYCSubmitRequest -v 2>&1 | tail -15
```

Expected: PASS (4 tests)

- [ ] **Step 5: Run full unit test suite to catch regressions**

```bash
cd api && python -m pytest apps/api/tests/unit/ -v 2>&1 | tail -20
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add api/apps/api/modules/auth/schemas.py api/apps/api/tests/unit/test_kyc_schemas.py
git commit -m "feat(kyc): User KYC accepts only ghana_card_id (required)"
```

---

### Task 2: Update backend Business KYC schema

**Files:**
- Modify: `api/apps/api/modules/kyc/schemas.py`
- Test: `api/apps/api/tests/unit/test_kyc_schemas.py`

- [ ] **Step 1: Write failing tests**

In `api/apps/api/tests/unit/test_kyc_schemas.py`, replace the `TestKYCSubmit` and `TestKYCSubmitBoundary` classes with:

```python
class TestKYCSubmit:
    def test_valid_business_reg_accepted(self):
        payload = KYCSubmit(business_registration_ref="BN-12345678")
        assert payload.business_registration_ref == "BN-12345678"

    def test_business_reg_required(self):
        with pytest.raises(ValidationError) as exc:
            KYCSubmit()
        errors = exc.value.errors()
        assert any(e["loc"] == ("business_registration_ref",) for e in errors)

    def test_tin_optional(self):
        payload = KYCSubmit(business_registration_ref="BN-12345678")
        assert payload.tin is None

    def test_tin_accepted_when_provided(self):
        payload = KYCSubmit(business_registration_ref="BN-12345678", tin="12345678901")
        assert payload.tin == "12345678901"

    def test_tin_wrong_length_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(business_registration_ref="BN-12345678", tin="123")

    def test_tin_non_numeric_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(business_registration_ref="BN-12345678", tin="ABCDEFGHIJK")

    def test_ghana_card_not_accepted(self):
        # ghana_card_id no longer belongs on Business KYC
        payload = KYCSubmit(business_registration_ref="BN-12345678")
        assert not hasattr(payload, "ghana_card_id") or "ghana_card_id" not in payload.model_fields


class TestKYCSubmitBoundary:
    def test_tin_boundary_minus_1(self):
        with pytest.raises(ValidationError):
            KYCSubmit(business_registration_ref="BN-12345678", tin="1234567890")

    def test_tin_boundary_plus_1(self):
        with pytest.raises(ValidationError):
            KYCSubmit(business_registration_ref="BN-12345678", tin="123456789012")

    def test_business_reg_too_long_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(business_registration_ref="X" * 101)

    def test_business_reg_at_max_length_accepted(self):
        payload = KYCSubmit(business_registration_ref="X" * 100)
        assert len(payload.business_registration_ref) == 100
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd api && python -m pytest apps/api/tests/unit/test_kyc_schemas.py::TestKYCSubmit apps/api/tests/unit/test_kyc_schemas.py::TestKYCSubmitBoundary -v 2>&1 | tail -20
```

Expected: FAIL — `test_business_reg_required` fails because `business_registration_ref` is currently optional.

- [ ] **Step 3: Update `KYCSubmit` in `api/apps/api/modules/kyc/schemas.py`**

Replace the `KYCSubmit` class:

```python
# BEFORE:
class KYCSubmit(BaseModel):
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)
    business_registration_ref: str | None = Field(None, max_length=100)
    documents: list[KYCDocument] = Field(default_factory=list, max_length=10)

# AFTER:
class KYCSubmit(BaseModel):
    business_registration_ref: str = Field(..., max_length=100)
    tin: str | None = Field(None, pattern=TIN_PATTERN)
    documents: list[KYCDocument] = Field(default_factory=list, max_length=10)
```

Also remove the unused `GHANA_CARD_PATTERN` import from `kyc/schemas.py` if it is no longer used anywhere in that file:

```python
# Check if GHANA_CARD_PATTERN is still used in kyc/schemas.py
# If only KYCSubmit used it, remove it from the import line:
from apps.api.core.gh_identifiers import TIN_PATTERN
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd api && python -m pytest apps/api/tests/unit/test_kyc_schemas.py -v 2>&1 | tail -25
```

Expected: all tests pass

- [ ] **Step 5: Run full unit test suite**

```bash
cd api && python -m pytest apps/api/tests/unit/ -v 2>&1 | tail -20
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add api/apps/api/modules/kyc/schemas.py api/apps/api/tests/unit/test_kyc_schemas.py
git commit -m "feat(kyc): Business KYC requires business_registration_ref, drops ghana_card_id"
```

---

### Task 3: Update mobile TypeScript types

**Files:**
- Modify: `mobile/src/types/auth.ts`
- Modify: `mobile/src/types/kyc.ts`

- [ ] **Step 1: Update `UserKYCSubmitDto` in `mobile/src/types/auth.ts`**

Find and replace:

```ts
// BEFORE:
export interface UserKYCSubmitDto {
  ghana_card_id?: string;
  tin?: string;
}

// AFTER:
export interface UserKYCSubmitDto {
  ghana_card_id: string;
}
```

- [ ] **Step 2: Update `BusinessKYCSubmitDto` in `mobile/src/types/kyc.ts`**

Find and replace:

```ts
// BEFORE:
export interface BusinessKYCSubmitDto {
  ghana_card_id?: string;
  tin?: string;
  business_registration_ref?: string;
  documents?: object;
}

// AFTER:
export interface BusinessKYCSubmitDto {
  business_registration_ref: string;
  tin?: string;
  documents?: object;
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors on `kyc.tsx` (it still passes old fields — fixed in Task 4). If errors appear only in `kyc.tsx`, that's expected. Any errors in other files must be fixed now.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/types/auth.ts mobile/src/types/kyc.ts
git commit -m "feat(kyc): update TS types — UserKYC ghana_card only, BusinessKYC business_reg + tin"
```

---

### Task 4: Rewrite the onboarding KYC screen

**Files:**
- Modify: `mobile/app/(auth)/onboarding/kyc.tsx`

The screen reads `user.kyc_status` from the auth store. If the user is already verified, Ghana Card is hidden. Business Registration Number is always required.

- [ ] **Step 1: Replace the entire file content**

```tsx
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { submitUserKyc } from '@/api/auth.api';
import { submitBusinessKyc } from '@/api/business.api';
import { toApiErrorMessage } from '@/api/errors';
import { WizardScreen } from '@/components/layout/WizardScreen';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

function formatGhanaCard(value: string): string {
  const stripped = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (stripped.length <= 3) return stripped;
  if (stripped.length <= 12) return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
  return `${stripped.slice(0, 3)}-${stripped.slice(3, 12)}-${stripped.slice(12, 13)}`;
}

function validGhanaCard(value: string): boolean {
  return /^GHA-\d{9}-\d$/.test(value);
}

function validTin(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^\d{11}$/.test(trimmed);
}

export default function KYCScreen() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const userAlreadyVerified = user?.kyc_status === 'verified';

  const [ghanaCardId, setGhanaCardId] = useState('');
  const [businessRegRef, setBusinessRegRef] = useState('');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);

  type KycErrors = { ghanaCard?: string; businessReg?: string; tin?: string; general?: string };
  const [errors, setErrors] = useState<KycErrors>({});

  function validate(): boolean {
    const next: KycErrors = {};

    if (!userAlreadyVerified && !validGhanaCard(ghanaCardId)) {
      next.ghanaCard = 'Enter Ghana Card in the format GHA-123456789-0.';
    }
    if (!businessRegRef.trim()) {
      next.businessReg = 'Business registration number is required.';
    }
    if (tin.trim() && !validTin(tin)) {
      next.tin = 'TIN must be exactly 11 digits.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    setErrors({});

    try {
      if (!userAlreadyVerified) {
        await submitUserKyc({ ghana_card_id: ghanaCardId });
      }
      await submitBusinessKyc({
        business_registration_ref: businessRegRef.trim(),
        tin: tin.trim() || undefined,
        documents: [],
      });
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, { scope: 'onboarding' });
      router.push('/onboarding/plan');
    } catch (err) {
      setErrors((prev) => ({ ...prev, general: toApiErrorMessage(err) }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <WizardScreen
      continueLabel="Continue · Plan"
      continueLoading={loading}
      onBack={() => router.back()}
      onContinue={submit}
      step={4}
      stepLabel="Identity"
      title="Verify identity and business"
      totalSteps={5}
    >
      {!userAlreadyVerified ? (
        <>
          <StyledTextInput
            autoCapitalize="characters"
            error={errors.ghanaCard}
            label="Ghana Card number"
            maxLength={15}
            onChangeText={(value) => {
              setGhanaCardId(formatGhanaCard(value));
              setErrors((prev) => ({ ...prev, ghanaCard: undefined }));
            }}
            placeholder="GHA-123456789-0"
            value={ghanaCardId}
          />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: -spacing.sm }}>
            Format: GHA-XXXXXXXXX-X
          </Text>
        </>
      ) : null}

      <StyledTextInput
        autoCapitalize="characters"
        error={errors.businessReg}
        label="Business registration number"
        onChangeText={(value) => {
          setBusinessRegRef(value);
          setErrors((prev) => ({ ...prev, businessReg: undefined }));
        }}
        placeholder="BN-12345678"
        value={businessRegRef}
      />

      <StyledTextInput
        autoCapitalize="characters"
        error={errors.tin}
        label="TIN (optional)"
        onChangeText={(value) => {
          setTin(value);
          setErrors((prev) => ({ ...prev, tin: undefined }));
        }}
        placeholder="12345678901"
        value={tin}
      />

      <View style={{ gap: spacing.sm }}>
        {errors.general ? <StatusMessage message={errors.general} tone="error" /> : null}
      </View>
    </WizardScreen>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep -i "kyc\|error" | head -20
```

Expected: no errors

- [ ] **Step 3: Run all mobile tests**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -8
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(auth)/onboarding/kyc.tsx
git commit -m "feat(kyc): split onboarding KYC — Ghana Card to user, business reg + TIN to business"
```

---

### Task 5: Run backend migration

The backend schema changes do not require a database migration (no model columns changed — only request schema validation). However, run the existing migration suite to confirm nothing is broken.

- [ ] **Step 1: Run integration tests**

```bash
cd api && python -m pytest apps/api/tests/integration/test_onboarding_compliance.py -v 2>&1 | tail -20
```

Expected: pass (or note any new failures introduced by schema tightening)

- [ ] **Step 2: Run full backend test suite**

```bash
cd api && python -m pytest apps/api/tests/ -v 2>&1 | tail -20
```

Expected: all pass

- [ ] **Step 3: Apply any pending Alembic migrations**

```bash
cd api && alembic upgrade head 2>&1
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade ...` or `INFO  [alembic.runtime.migration] No new revisions` if already up to date.

- [ ] **Step 4: Commit if any migration files were auto-generated**

Only commit if `alembic upgrade head` or `alembic revision` produced new files:

```bash
git add api/migrations/versions/
git commit -m "chore(migrations): apply pending migrations post KYC schema change"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full mobile test suite**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -8
```

Expected: all tests pass (207+)

- [ ] **Step 2: Full backend test suite**

```bash
cd api && python -m pytest apps/api/tests/ -v 2>&1 | tail -15
```

Expected: all pass

- [ ] **Step 3: Full TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors

- [ ] **Step 4: Final commit and push**

```bash
git push origin production-readiness-hardening
```
