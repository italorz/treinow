const pt: Record<string, string> = {
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
