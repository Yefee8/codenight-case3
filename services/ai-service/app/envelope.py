from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ApiError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]+$")
    message: str = Field(min_length=1, max_length=500)
    field_errors: dict[str, list[str]] = Field(default_factory=dict)


class ApiEnvelope(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: T | None
    error: ApiError | None
    request_id: UUID

    @classmethod
    def ok(cls, data: T, request_id: UUID) -> "ApiEnvelope[T]":
        return cls(success=True, data=data, error=None, request_id=request_id)

    @classmethod
    def fail(cls, code: str, message: str, request_id: UUID) -> "ApiEnvelope[None]":
        return cls(
            success=False,
            data=None,
            error=ApiError(code=code, message=message),
            request_id=request_id,
        )
