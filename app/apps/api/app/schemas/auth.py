from pydantic import BaseModel, EmailStr, Field, field_validator

from .common import Role


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: Role

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return value.strip().lower()
