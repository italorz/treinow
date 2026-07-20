from pydantic import BaseModel, Field, field_validator

from .common import Equipment, Goal, InjuryRegion, InjurySeverity, InjuryStatus, Level, Muscle


class InjuryInput(BaseModel):
    region: InjuryRegion
    severity: InjurySeverity
    status: InjuryStatus
    medicallyCleared: bool


class MetaInput(BaseModel):
    goal: Goal
    level: Level
    trainingDays: list[int] = Field(min_length=1)
    durationMinutes: str
    location: str
    equipment: list[Equipment] = Field(min_length=1)
    weightKg: float = Field(ge=30, le=300)
    heightCm: int = Field(ge=120, le=230)
    age: int = Field(ge=14, le=100)
    sex: str
    priorityMuscles: list[Muscle] = Field(max_length=3)
    intensity: str
    injuries: list[InjuryInput] = Field(max_length=8)

    @field_validator("trainingDays")
    @classmethod
    def _validate_days(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("weekday deve estar entre 0 e 6")
        return value

    @field_validator("durationMinutes")
    @classmethod
    def _validate_duration(cls, value: str) -> str:
        if value not in ("30", "45", "60", "75", "90"):
            raise ValueError("duração inválida")
        return value

    @property
    def duration_minutes_int(self) -> int:
        return int(self.durationMinutes)
