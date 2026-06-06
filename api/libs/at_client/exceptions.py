"""Africa's Talking specific exceptions."""


class ATError(Exception):
    """Base exception for Africa's Talking errors."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ATValidationError(ATError):
    """Raised when request validation fails."""
    pass


class ATAuthenticationError(ATError):
    """Raised when authentication fails."""
    pass


class ATInsufficientBalanceError(ATError):
    """Raised when account has insufficient balance."""
    pass


class ATServerError(ATError):
    """Raised when Africa's Talking server returns an error."""
    pass