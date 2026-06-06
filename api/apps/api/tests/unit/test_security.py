"""Unit tests for security utilities."""

import hashlib
from uuid import uuid4

import pytest

from apps.api.core.security import (
    create_access_token,
    decode_token,
    generate_otp,
    hash_password,
    verify_lender_api_key,
    verify_password,
)


class TestJWT:
    def test_access_token_roundtrip(self):
        user_id = uuid4()
        business_id = uuid4()
        token = create_access_token(user_id=user_id, business_id=business_id, role="owner")
        payload = decode_token(token)
        assert payload["sub"] == str(user_id)
        assert payload["business_id"] == str(business_id)
        assert payload["role"] == "owner"
        assert payload["type"] == "access"

    def test_token_without_business(self):
        user_id = uuid4()
        token = create_access_token(user_id=user_id)
        payload = decode_token(token)
        assert payload["business_id"] is None

    def test_invalid_token_raises(self):
        from jose import JWTError

        with pytest.raises(JWTError):
            decode_token("not.a.valid.token")


class TestOTP:
    def test_otp_is_numeric(self):
        otp = generate_otp()
        assert otp.isdigit()

    def test_otp_default_length_is_6(self):
        assert len(generate_otp()) == 6

    def test_otp_custom_length(self):
        assert len(generate_otp(length=4)) == 4


class TestPasswordHashing:
    def test_hash_and_verify(self):
        password = "SuperSecret123!"
        hashed = hash_password(password)
        assert hashed != password
        assert verify_password(password, hashed)

    def test_wrong_password_fails(self):
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)


class TestLenderApiKey:
    """Test the lender API key verification function."""

    def test_no_stored_hash_always_rejected(self):
        """When no hash is stored, key must be rejected in all environments."""
        assert not verify_lender_api_key("any-key", stored_hash=None)

    def test_wrong_key_rejected(self):
        stored = hashlib.sha256(b"correct-key").hexdigest()
        assert not verify_lender_api_key("wrong-key", stored_hash=stored)

    def test_correct_key_accepted(self):
        stored = hashlib.sha256(b"correct-key").hexdigest()
        assert verify_lender_api_key("correct-key", stored_hash=stored)

    def test_empty_string_key_rejected(self):
        stored = hashlib.sha256(b"correct-key").hexdigest()
        assert not verify_lender_api_key("", stored_hash=stored)
