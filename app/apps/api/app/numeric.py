import math


def js_round(value: float) -> int:
    """Replica Math.round do JS (0.5 sempre arredonda para cima), diferente do
    round() do Python que usa banker's rounding e divergiria em valores como
    2.5 -> Math.round da 3, round() do Python daria 2."""
    return math.floor(value + 0.5)


def round1(value: float) -> float:
    """Arredonda para 1 casa decimal com a mesma regra de Math.round(x*10)/10."""
    return js_round(value * 10) / 10
