from typing import Literal

Role = Literal["student", "trainer"]
Goal = Literal["mais_disposto", "mais_bonito", "mais_forte", "mais_leve", "mais_saudavel", "menos_estressado"]
Level = Literal["iniciante", "intermediario", "avancado"]
Equipment = Literal["peso_corporal", "halter", "anilha", "barra", "cabo", "maquina", "smith", "kettlebell", "elastico", "banco", "bola", "outro"]
Muscle = Literal["core", "peitoral", "costas", "ombro", "biceps", "triceps", "antebraco", "trapezio", "gluteos", "pernas", "panturrilha"]
InjuryRegion = Literal["ombro", "cotovelo", "punho", "coluna_cervical", "coluna_lombar", "quadril", "joelho", "tornozelo"]
InjurySeverity = Literal["leve", "moderada", "grave"]
InjuryStatus = Literal["recuperacao", "cronica", "dor_aguda"]
Phase = Literal["aquecimento", "principal", "alongamento"]
