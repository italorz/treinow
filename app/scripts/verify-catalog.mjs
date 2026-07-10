import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../catalog/exercises.pt-BR.json", import.meta.url), "utf8"));
const failures = [];
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const invariants = [
  ["lyingcrossover", "core"],
  ["pushpress", "ombro"],
  ["closegripbenchpress", "triceps"],
  ["proneextension", "costas"],
  ["straightarmpulldown", "costas"],
  ["reardelt", "ombro"],
  ["rearlateral", "ombro"],
  ["wrist", "antebraco"],
  ["calf", "panturrilha"],
  ["legextension", "pernas"],
  ["hipabduction", "gluteos"],
  ["triceps", "triceps"],
  ["biceps", "biceps"]
];

for (const item of catalog) {
  if (item.needsReview) failures.push(`${item.nameRaw}: revisão pendente`);
  if (!item.name || !item.musclePrimary || !item.movementPattern || !item.equipment) {
    failures.push(`${item.nameRaw}: metadados obrigatórios ausentes`);
  }
  const raw = normalize(item.nameRaw);
  for (const [needle, muscle] of invariants) {
    if (raw.includes(needle) && item.musclePrimary !== muscle) {
      failures.push(`${item.nameRaw}: esperado ${muscle}, recebido ${item.musclePrimary}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Catálogo verificado: ${catalog.length} exercícios, sem revisões pendentes ou conflitos conhecidos.`);
