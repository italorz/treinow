"""General movement cues, not a diagnosis or a personalized rehabilitation plan.

Safety references: Mayo Clinic, weight-training/art-20045842;
AAOS OrthoInfo, rotator-cuff-and-shoulder-conditioning-program.
"""

from .catalog import knowledge

MUSCLES = {
    "core": "abdômen", "peitoral": "peitoral", "costas": "costas",
    "ombro": "ombros", "biceps": "bíceps", "triceps": "tríceps",
    "antebraco": "antebraços", "trapezio": "trapézio", "gluteos": "glúteos",
    "pernas": "coxas", "panturrilha": "panturrilhas",
}

# Match catalog movement families rather than guessing technique from a title.
CUES = {
    "peitoral_press": (
        "Movimento de empurrar para trabalhar o peitoral e os músculos auxiliares.",
        "Mantenha o tronco estável e os punhos alinhados aos antebraços; empurre sem perder o apoio demonstrado no vídeo.",
        "Retorne devagar, sem deixar os ombros avançarem ou forçar a amplitude.",
        "Punhos dobrados, ombros elevados e perda do apoio do tronco são sinais para rever a execução.",
        "Se houver pinçamento no ombro ou dor no punho, interrompa; não tente corrigir insistindo na repetição.",
    ),
    "peitoral_aducao": (
        "Aproximação dos braços para trabalhar o peitoral.",
        "Mantenha uma pequena flexão nos cotovelos e preserve esse ângulo durante o movimento.",
        "Abra e feche os braços com controle, sem levar os ombros além da amplitude confortável.",
        "Transformar o movimento em uma pressão ou esticar demais os braços muda a execução.",
        "Dor ou pinçamento na frente do ombro exige interrupção e avaliação da amplitude com um profissional.",
    ),
    "costas_remada": (
        "Puxada horizontal para trabalhar as costas e os músculos auxiliares.",
        "Estabilize o tronco e conduza os cotovelos conforme a trajetória do vídeo, sem puxar com um impulso do corpo.",
        "Retorne de forma controlada; mantenha o pescoço alinhado ao tronco.",
        "Balançar o tronco ou encolher os ombros para completar a repetição pode indicar carga excessiva.",
        "Se o pescoço ficar tenso enquanto você encolhe os ombros, reveja a carga e a postura; dor lombar pede interrupção.",
    ),
    "costas_puxada": (
        "Puxada vertical para trabalhar as costas.",
        "Mantenha o tronco estável e conduza os cotovelos sem dar impulso com o corpo.",
        "Não projete a cabeça para frente nem force os ombros no final da amplitude.",
        "Balançar o corpo e elevar os ombros para terminar são compensações a revisar.",
        "O bíceps também participa; senti-lo não significa erro. Dor no ombro ou cotovelo exige interrupção.",
    ),
    "costas_pullover": (
        "Movimento dos braços para trabalhar as costas, com participação do tronco.",
        "Mantenha o abdômen firme e uma flexão confortável dos cotovelos, conforme o vídeo.",
        "Limite a amplitude antes de arquear a lombar ou forçar os ombros.",
        "Abrir as costelas e arquear as costas para ampliar o movimento são compensações.",
        "Dor na lombar ou pinçamento no ombro pede interrupção e orientação profissional.",
    ),
    "costas_extensao": (
        "Extensão do tronco com participação da musculatura das costas.",
        "Use a amplitude demonstrada, mantendo o pescoço alinhado ao tronco.",
        "Controle a subida e a descida, sem ultrapassar o alinhamento por impulso.",
        "Jogar a cabeça para trás ou exagerar o arco da lombar são sinais de compensação.",
        "Esforço muscular nas costas pode ocorrer; dor focal, irradiada ou crescente não deve ser ignorada.",
    ),
    "ombro_cabeca": (
        "Elevação dos braços para trabalhar uma região dos ombros.",
        "Mantenha os cotovelos levemente flexionados e siga o plano de elevação do vídeo.",
        "Suba e desça sem embalo; não force a altura quando perder o controle.",
        "Encolher os ombros e balançar o tronco para levantar a carga são compensações.",
        "Tensão no pescoço junto com ombros encolhidos sugere rever carga e postura, não um diagnóstico. Pinçamento exige interrupção.",
    ),
    "ombro_desenvolvimento": (
        "Pressão dos braços para trabalhar os ombros e tríceps.",
        "Mantenha punhos alinhados e tronco estável; empurre conforme a posição demonstrada.",
        "Use amplitude confortável sem arquear a lombar para terminar a repetição.",
        "Projetar as costelas e perder o alinhamento dos punhos são sinais para revisar a execução.",
        "Dor no ombro ou na lombar não é um objetivo do exercício: interrompa e peça orientação.",
    ),
    "ombro_remada_alta": (
        "Elevação da carga junto ao corpo, com participação dos ombros e trapézio.",
        "Siga a pegada e a trajetória demonstradas, sem elevar os cotovelos além do confortável.",
        "Mantenha tronco e pescoço estáveis, sem puxar com impulso.",
        "Elevar os ombros de forma exagerada e forçar a altura são compensações.",
        "Pinçamento no ombro exige interrupção; esse movimento pode precisar de substituição pelo profissional.",
    ),
    "manguito_rotador": (
        "Rotação controlada do ombro para preparação ou fortalecimento do manguito, conforme a prescrição.",
        "Mantenha a posição do braço e do cotovelo mostrada no vídeo; rode sem movimentar o tronco.",
        "Use pouca resistência e amplitude confortável, sem forçar o final do movimento.",
        "Mover o cotovelo ou girar o tronco para ampliar a rotação são compensações a revisar.",
        "Não é para sentir dor dentro do ombro. Com lesão, faça apenas a variação e amplitude liberadas pelo profissional.",
    ),
    "biceps_": (
        "Flexão do cotovelo para trabalhar bíceps e músculos auxiliares.",
        "Mantenha os braços estáveis e os punhos alinhados à pegada mostrada no vídeo.",
        "Flexione e retorne sem dar impulso com o quadril ou os ombros.",
        "Balançar o corpo e dobrar os punhos para completar a série são compensações.",
        "Os antebraços também podem trabalhar. Dor no punho ou cotovelo pede interrupção, não aumento de carga.",
    ),
    "triceps_extensao": (
        "Extensão dos cotovelos para trabalhar o tríceps.",
        "Mantenha os braços na posição demonstrada e movimente principalmente os cotovelos.",
        "Retorne com controle, sem bater no final da extensão.",
        "Deslocar os ombros ou inclinar o tronco para empurrar a carga são compensações.",
        "Dor no cotovelo ou no ombro exige interrupção e revisão da variação com um profissional.",
    ),
    "triceps_press": (
        "Movimento de empurrar com participação importante do tríceps.",
        "Preserve os apoios e o alinhamento de punhos, cotovelos e tronco mostrados no vídeo.",
        "Desça com controle, sem forçar a amplitude dos ombros.",
        "Perder o apoio ou deixar o tronco cair para completar a repetição são sinais para rever a execução.",
        "O peitoral também pode participar. Dor no ombro ou punho exige interrupção.",
    ),
    "pernas_agachamento": (
        "Flexão e extensão de quadris e joelhos para trabalhar coxas e glúteos.",
        "Mantenha os pés apoiados e os joelhos acompanhando a direção dos pés.",
        "Use amplitude que permita manter tronco e pelve controlados, seguindo os apoios do vídeo.",
        "Joelhos caindo para dentro, calcanhares perdendo apoio ou pelve perdendo controle são sinais para revisar.",
        "Dor nos joelhos ou lombar exige interrupção; sentir glúteos e coxas juntos não significa execução incorreta.",
    ),
    "pernas_unilateral": (
        "Movimento com foco em uma perna, trabalhando força e estabilidade.",
        "Mantenha o apoio firme e o joelho acompanhando a direção do pé.",
        "Controle a pelve e o tronco durante a subida e a descida.",
        "Desequilibrar a pelve ou deixar o joelho cair para dentro são compensações.",
        "Dor no joelho, quadril ou tornozelo exige interrupção; ajuste o apoio com um profissional.",
    ),
    "posterior_coxa_flexao": (
        "Flexão dos joelhos para trabalhar a parte posterior das coxas.",
        "Mantenha quadris e tronco apoiados conforme o vídeo ou o ajuste do aparelho.",
        "Flexione e estenda com controle, sem levantar a pelve para mover a carga.",
        "Arquear a lombar ou perder o apoio dos quadris são compensações.",
        "Dor atrás do joelho ou na lombar exige interrupção e revisão do ajuste.",
    ),
    "quadriceps_extensao": (
        "Extensão dos joelhos para trabalhar a parte da frente das coxas.",
        "Ajuste o apoio conforme o vídeo e, no aparelho, alinhe o eixo de movimento ao joelho com ajuda do instrutor.",
        "Suba e desça sem bater no final da extensão nem perder o apoio do quadril.",
        "Levantar a pelve e dar trancos na carga são sinais para revisar a execução.",
        "Dor no joelho exige interrupção; não tente compensar com mais velocidade.",
    ),
    "gluteo_extensao": (
        "Extensão do quadril para trabalhar os glúteos.",
        "Mantenha abdômen e pelve controlados, seguindo os apoios do vídeo.",
        "Termine a extensão sem arquear a lombar para ganhar amplitude.",
        "Abrir as costelas e girar a pelve são compensações a revisar.",
        "A parte posterior da coxa pode participar. Dor lombar exige interrupção e revisão da amplitude.",
    ),
    "gluteo_medio": (
        "Afastamento ou rotação da perna para trabalhar a região lateral dos glúteos.",
        "Estabilize a pelve e siga a trajetória da perna mostrada no vídeo.",
        "Controle a volta sem girar o tronco para ampliar o movimento.",
        "Inclinar o corpo e girar a pelve para mover a carga são compensações.",
        "Dor na articulação do quadril exige interrupção; a sensação isolada não identifica qual músculo está trabalhando.",
    ),
    "adutores": (
        "Aproximação das pernas para trabalhar a região interna das coxas.",
        "Preserve os apoios e mantenha a pelve estável conforme o vídeo.",
        "Use amplitude confortável, sem abrir as pernas à força.",
        "Impulso e perda do apoio da pelve são sinais para revisar o movimento.",
        "Dor na virilha ou no quadril exige interrupção e avaliação profissional.",
    ),
    "panturrilha_": (
        "Movimento do tornozelo para trabalhar as panturrilhas.",
        "Mantenha a posição dos joelhos e os apoios mostrados no vídeo.",
        "Eleve e abaixe os calcanhares com controle, sem quicar ou torcer os tornozelos.",
        "Usar impulso dos joelhos ou deixar o tornozelo perder o alinhamento são compensações.",
        "Dor no tendão de Aquiles ou na articulação do tornozelo exige interrupção.",
    ),
    "trapezio_elevacao": (
        "Elevação dos ombros para trabalhar o trapézio.",
        "Mantenha cabeça e tronco alinhados e eleve os ombros conforme o vídeo.",
        "Desça com controle, sem fazer círculos nem dar impulso com o corpo.",
        "Projetar a cabeça para frente ou balançar o tronco são compensações.",
        "O trapézio próximo ao pescoço participa, mas dor cervical, formigamento ou dor irradiada pede interrupção.",
    ),
    "antebraco_": (
        "Movimento do punho ou antebraço para trabalhar seus músculos.",
        "Mantenha o apoio e a direção da pegada demonstrados no vídeo.",
        "Faça o movimento devagar, sem forçar o punho no final da amplitude.",
        "Mover todo o braço para vencer a carga é uma compensação a revisar.",
        "Dor no punho ou cotovelo, dormência ou formigamento exige interrupção.",
    ),
    "core_": (
        "Movimento ou sustentação do tronco para trabalhar a musculatura abdominal.",
        "Controle a posição da pelve e mantenha o pescoço alinhado conforme a variação do vídeo.",
        "Respire durante o esforço e limite a amplitude antes de perder o controle do tronco.",
        "Dar impulso, puxar o pescoço ou perder o alinhamento da lombar são sinais para revisar a execução.",
        "Outros músculos estabilizam o movimento; dor lombar ou cervical exige interrupção, não insistência.",
    ),
}

HINGE = (
    "Movimento de dobrar e estender o quadril, com participação dos glúteos e posteriores das coxas.",
    "Leve o quadril para trás, mantendo o tronco controlado e a carga próxima ao corpo quando aplicável.",
    "Use a amplitude do vídeo sem arredondar ou arquear a lombar para descer mais.",
    "Perder o controle da coluna ou afastar a carga do corpo são sinais para revisar a execução.",
    "Os músculos das costas também estabilizam. Dor lombar ou dor irradiada pela perna exige interrupção.",
)


def exercise_guidance(exercise) -> dict:
    info = knowledge(exercise)
    targets = info.get("targetMuscles") or [exercise.muscle_primary]
    labels = list(dict.fromkeys(MUSCLES[m] for m in targets if m in MUSCLES))
    target_text = ", ".join(labels) or "os músculos indicados no vídeo"
    key = exercise.target_key or ""
    general = False
    if exercise.is_stretch:
        cues = (
            f"Alongamento com foco em {target_text}; siga a posição demonstrada.",
            "Entre na posição devagar, mantenha os apoios e respire normalmente.",
            "Use uma tensão leve e confortável, sem forçar a amplitude nem fazer balanços.",
            "Prender a respiração ou mudar os apoios para ir mais longe são sinais para diminuir a amplitude.",
            "Alongamento não deve provocar dor. Dor articular, formigamento ou sensação de choque exige interrupção.",
        )
    elif key.startswith("manguito_rotador"):
        cues = CUES["manguito_rotador"]
    elif exercise.is_warmup or info.get("exerciseType") == "Aerobic":
        cues = (
            f"Preparação ou atividade dinâmica envolvendo {target_text}.",
            "Comece em ritmo leve, seguindo os apoios e a trajetória do vídeo.",
            "Aumente o ritmo somente enquanto conseguir controlar o movimento e respirar confortavelmente.",
            "Perder o equilíbrio ou precisar de impulso para manter o movimento pede redução do ritmo.",
            "Dor, tontura ou falta de ar incomum pede interrupção. Com lesão, siga a atividade liberada pelo profissional.",
        )
    elif key in ("pernas_hinge", "posterior_coxa_hinge"):
        cues = HINGE
    else:
        cues = next((value for prefix, value in CUES.items() if key.startswith(prefix)), None)
        if cues is None:
            general = True
            cues = (
                f"Exercício com foco em {target_text}. Orientação geral: confirme a técnica desta variação com um profissional.",
                "Observe a posição inicial, os apoios e a trajetória no vídeo antes de começar.",
                "Comece com baixa resistência e mantenha o movimento controlado, sem forçar a amplitude.",
                "Perder os apoios, dar trancos ou precisar de impulso são sinais para revisar a execução.",
                "Não use a localização da sensação para diagnosticar erro. Dor, formigamento ou perda de força exige interrupção.",
            )
    return {
        "description": cues[0], "steps": list(cues[1:3]), "commonMistake": cues[3],
        "attention": cues[4], "targetMuscles": labels, "general": general,
        "sensation": "Esforço pode ocorrer nos músculos-alvo e auxiliares. Onde você sente, sozinho, não confirma execução correta ou incorreta.",
        "stop": "Interrompa se houver dor aguda, articular, irradiada, formigamento ou perda de força. Peça avaliação profissional antes de continuar.",
    }
