"""Unit tests for KYC schema field-level validation (Ghana Card ID and TIN)."""

import pytest
from pydantic import ValidationError

from apps.api.modules.auth.schemas import KYCSubmitRequest, UserUpdate
from apps.api.modules.kyc.schemas import KYCSubmit


class TestKYCSubmit:
    def test_valid_ghana_card_accepted(self):
        payload = KYCSubmit(ghana_card_id="GHA-123456789-0")
        assert payload.ghana_card_id == "GHA-123456789-0"

    def test_malformed_ghana_card_rejected(self):
        with pytest.raises(ValidationError) as exc:
            KYCSubmit(ghana_card_id="BADCARD123")
        errors = exc.value.errors()
        assert any(e["loc"] == ("ghana_card_id",) for e in errors)

    def test_no_ghana_card_allowed(self):
        payload = KYCSubmit()
        assert payload.ghana_card_id is None

    def test_valid_tin_accepted(self):
        payload = KYCSubmit(tin="12345678901")
        assert payload.tin == "12345678901"

    def test_tin_wrong_length_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(tin="123")

    def test_tin_non_numeric_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(tin="ABCDEFGHIJK")


class TestUserUpdateTin:
    def test_valid_tin_accepted(self):
        u = UserUpdate(tin="12345678901")
        assert u.tin == "12345678901"

    def test_tin_10_digits_rejected(self):
        with pytest.raises(ValidationError):
            UserUpdate(tin="1234567890")  # 10 digits, boundary-1

    def test_tin_12_digits_rejected(self):
        with pytest.raises(ValidationError):
            UserUpdate(tin="123456789012")  # 12 digits, boundary+1

    def test_tin_alphanumeric_rejected(self):
        with pytest.raises(ValidationError):
            UserUpdate(tin="1234567890A")


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


class TestKYCSubmitBoundary:
    def test_tin_boundary_minus_1(self):
        with pytest.raises(ValidationError):
            KYCSubmit(tin="1234567890")  # 10 digits

    def test_tin_boundary_plus_1(self):
        with pytest.raises(ValidationError):
            KYCSubmit(tin="123456789012")  # 12 digits

    def test_ghana_card_8_digits_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(ghana_card_id="GHA-12345678-0")

    def test_all_none_allowed(self):
        payload = KYCSubmit()
        assert payload.ghana_card_id is None
        assert payload.tin is None


class TestKYCDocument:
    def test_valid_document_accepted(self):
        from apps.api.modules.kyc.schemas import KYCDocument

        doc = KYCDocument(
            document_type="ghana_card_front", url="https://cdn.smeflow.app/docs/abc.jpg"
        )
        assert doc.document_type == "ghana_card_front"
        assert doc.url == "https://cdn.smeflow.app/docs/abc.jpg"

    def test_invalid_document_type_rejected(self):
        from apps.api.modules.kyc.schemas import KYCDocument

        with pytest.raises(ValidationError):
            KYCDocument(document_type="passport", url="https://example.com/a.jpg")

    def test_valid_document_with_hash(self):
        from apps.api.modules.kyc.schemas import KYCDocument

        doc = KYCDocument(
            document_type="ghana_card_back",
            url="https://cdn.smeflow.app/docs/abc.jpg",
            sha256="a" * 64,
        )
        assert doc.sha256 == "a" * 64

    def test_hash_wrong_length_rejected(self):
        from apps.api.modules.kyc.schemas import KYCDocument

        with pytest.raises(ValidationError):
            KYCDocument(
                document_type="ghana_card_front", url="https://cdn.smeflow.app/a.jpg", sha256="abc"
            )


class TestKYCSubmitDocuments:
    def test_empty_documents_list_accepted(self):
        payload = KYCSubmit(documents=[])
        assert payload.documents == []

    def test_valid_document_in_list(self):
        payload = KYCSubmit(
            documents=[
                {"document_type": "ghana_card_front", "url": "https://cdn.smeflow.app/docs/abc.jpg"}
            ]
        )
        assert len(payload.documents) == 1

    def test_invalid_document_type_in_list_rejected(self):
        with pytest.raises(ValidationError):
            KYCSubmit(documents=[{"document_type": "passport", "url": "https://example.com/a.jpg"}])

    def test_too_many_documents_rejected(self):
        docs = [
            {"document_type": "ghana_card_front", "url": f"https://cdn.smeflow.app/{i}.jpg"}
            for i in range(11)
        ]
        with pytest.raises(ValidationError):
            KYCSubmit(documents=docs)

    def test_no_documents_defaults_to_empty_list(self):
        payload = KYCSubmit()
        assert payload.documents == []


class TestKYCStatusPollResponse:
    def test_not_submitted_status(self):
        from apps.api.modules.kyc.schemas import KYCStatusPollResponse

        r = KYCStatusPollResponse(status="not_submitted")
        assert r.status == "not_submitted"
        assert r.failure_reason is None
        assert r.verified_at is None

    def test_verified_status(self):
        from datetime import datetime, timezone

        from apps.api.modules.kyc.schemas import KYCStatusPollResponse

        r = KYCStatusPollResponse(status="verified", verified_at=datetime.now(timezone.utc))
        assert r.status == "verified"

    def test_failed_status_with_reason(self):
        from apps.api.modules.kyc.schemas import KYCStatusPollResponse

        r = KYCStatusPollResponse(
            status="failed", failure_reason="Ghana Card not found in NIA database"
        )
        assert r.failure_reason == "Ghana Card not found in NIA database"

    def test_invalid_status_rejected(self):
        from apps.api.modules.kyc.schemas import KYCStatusPollResponse

        with pytest.raises(ValidationError):
            KYCStatusPollResponse(status="unknown_status")
