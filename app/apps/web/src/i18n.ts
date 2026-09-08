const pt: Record<string, string> = {
  suspensao: "Suspensão", barra_fixa: "Barra fixa", rolo: "Rolo de liberação", landmine: "Landmine",
  carga_adicional: "Carga adicional",
  bastao: "Bastão", corda: "Corda", treno: "Trenó", roda_abdominal: "Roda abdominal",
  plataforma_vibratoria: "Plataforma vibratória", cinta_cabeca: "Cinta de cabeça",
  peso_corporal: "Peso do corpo", halter: "Halter", anilha: "Anilha", barra: "Barra",
  cabo: "Cabo", maquina: "Máquina", smith: "Smith", kettlebell: "Kettlebell",
  elastico: "Elástico", banco: "Banco", bola: "Bola", outro: "Outro",
  iniciante: "Iniciante", intermediario: "Intermediário", avancado: "Avançado",
  peitoral: "Peitoral", ombro: "Ombros", biceps: "Bíceps", triceps: "Tríceps",
  trapezio: "Trapézio", costas: "Costas", core: "Core", pernas: "Pernas",
  gluteos: "Glúteos", panturrilha: "Panturrilhas", antebraco: "Antebraços"
};
const dictionaries: Record<string, Record<string, string>> = { pt };
export function domainLabel(value: string) {
  const language = (navigator.language || "pt-BR").split("-")[0]!;
  return dictionaries[language]?.[value] ?? pt[value] ?? value.replaceAll("_", " ");
}
