import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const source = join(root, "packages", "acervo-videos", "catalogo", "videos_identificados.csv");
const videoDir = join(root, "packages", "acervo-videos", "HD", "Sem categoria");
const output = join(root, "catalog", "exercises.pt-BR.json");

const muscleMap = { Abs: "core", Chest: "peitoral", Lats: "costas", Shoulders: "ombro", Biceps: "biceps", Triceps: "triceps", Forearms: "antebraco", Traps: "trapezio", Glutes: "gluteos", Hamstrings: "pernas", Quads: "pernas", Calves: "panturrilha" };
const equipmentMap = { "Body weight": "peso_corporal", Dumbbell: "halter", Cable: "cabo", Barbell: "barra", "EZ Barbell": "barra", "Trap bar": "barra", "Leverage machine": "maquina", "Special Machine": "maquina", "Sled machine": "maquina", Treadmill: "maquina", "Smith machine": "smith", Band: "elastico", "Resistance Band": "elastico", Kettlebell: "kettlebell", "Stability ball": "bola", "Medicine Ball": "bola", Rollball: "bola", "Bosu ball": "bola", "Special Bench": "banco" };

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift().map(value => value.replace(/^\uFEFF/, ""));
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function normalize(value) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function classifyMuscles(raw) { const mapped = unique(raw.split("|").map(value => muscleMap[value])); return { primary: mapped[0] ?? "core", secondary: mapped.slice(1) }; }
function equipment(row) { return equipmentMap[row.equipamento] ?? equipmentMap[row.equipamento_secundario] ?? "outro"; }

function movementPattern(name, muscle) {
  const hay = normalize(name).replaceAll(" ", "");
  if (/stretch|pose|mobility/.test(hay)) return "mobilidade";
  if (/squat|lunge|stepup|legpress/.test(hay)) return "squat";
  if (/deadlift|goodmorning|hipthrust|bridge|legcurl/.test(hay)) return "hinge";
  if (/row|pullup|chinup|pulldown|pullover/.test(hay)) return "pull";
  if (/press|pushup|dip/.test(hay)) return "press";
  if (/curl/.test(hay)) return "curl";
  if (/extension|pushdown|kickback/.test(hay)) return "extension";
  if (/twist|rotation|woodchop|sidebend/.test(hay)) return "rotation";
  if (/fly|crossover|adduction/.test(hay)) return "fly";
  if (/raise|abduction/.test(hay)) return "raise";
  return muscle === "core" ? "core" : "outro";
}

function joints(muscle) {
  return { ombro: ["ombro"], peitoral: ["ombro", "cotovelo"], costas: ["ombro", "cotovelo"], biceps: ["cotovelo"], triceps: ["cotovelo"], antebraco: ["punho", "cotovelo"], pernas: ["quadril", "joelho"], gluteos: ["quadril", "coluna_lombar"], panturrilha: ["tornozelo"], core: ["coluna_lombar"], trapezio: ["coluna_cervical", "ombro"] }[muscle] ?? [];
}

function targetKey(name, muscle, pattern) {
  const hay = normalize(name).replaceAll(" ", "");
  if (muscle === "ombro" && /externalrotation|shoulderrotationoutward|rotatorcuff/.test(hay)) return "manguito_rotador_externo";
  if (muscle === "ombro" && /internalrotation|shoulderrotationinward/.test(hay)) return "manguito_rotador_interno";
  if (muscle === "pernas" && /hamstring|legcurl|stiffleg|romanian/.test(hay)) return "posterior_coxa";
  if (muscle === "pernas" && /quad|legextension/.test(hay)) return "quadriceps_extensao";
  if (muscle === "gluteos" && /abduction|clamshell/.test(hay)) return "gluteo_medio";
  if (muscle === "peitoral" && /incline/.test(hay)) return "peitoral_superior";
  if (muscle === "costas" && /row/.test(hay)) return "costas_remada_horizontal";
  if (muscle === "costas" && /pullup|chinup|pulldown/.test(hay)) return "costas_puxada_vertical";
  return `${muscle}_${pattern}`.slice(0, 64);
}

function complexity(name) {
  const hay = normalize(name).replaceAll(" ", "");
  if (/snatch|jerk|handstand|pistol|muscleup|plyo/.test(hay)) return "avancado";
  if (/deadlift|lunge|clean|singleleg|pullup|chinup/.test(hay)) return "intermediario";
  return "iniciante";
}

function videoMeta(fileName) {
  const path = join(videoDir, fileName);
  statSync(path);
  let stream = {};
  try {
    const result = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,duration", "-of", "json", path], { encoding: "utf8" });
    stream = JSON.parse(result).streams?.[0] ?? {};
  } catch { /* Os hashes e arquivos continuam válidos quando ffprobe não está instalado. */ }
  return { fileName, objectKey: `exercises/${fileName}`, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), codec: stream.codec_name ?? "unknown", width: Number(stream.width ?? 0), height: Number(stream.height ?? 0), durationSeconds: Number(Number(stream.duration ?? 0).toFixed(3)) };
}

const rows = parseCsv(readFileSync(source, "utf8"));
const byExercise = new Map();
for (const row of rows) {
  if (row.arquivo_encontrado !== "sim") continue;
  const current = byExercise.get(row.exercise_id) ?? { row, variants: {} };
  current.variants[row.genero_video] = videoMeta(row.arquivo_mp4);
  byExercise.set(row.exercise_id, current);
}

const catalog = [...byExercise.entries()].map(([exerciseId, { row, variants }]) => {
  const muscles = classifyMuscles(row.musculos_alvo);
  const pattern = movementPattern(row.nome, muscles.primary);
  const isStretch = row.tipo === "Stretching";
  const warmupEligible = isStretch || /external rotation|internal rotation|rotator cuff|arm circle|arm swing/i.test(row.nome);
  const primaryVideo = variants.masculino ?? variants.feminino ?? Object.values(variants)[0];
  return {
    slug: exerciseId, locale: "pt-BR", name: row.nome, nameRaw: row.nome,
    musclePrimary: muscles.primary, secondaryMuscles: muscles.secondary,
    equipment: equipment(row), complexity: complexity(row.nome), movementPattern: pattern,
    targetKey: targetKey(row.nome, muscles.primary, pattern),
    isUnilateral: /single|one arm|one leg|unilateral|alternat/i.test(row.nome),
    isStretch, isWarmup: warmupEligible, joints: joints(muscles.primary), contraindications: joints(muscles.primary),
    requiresHighMindMuscleAwareness: /fly|raise|isometric|abduction|adduction/i.test(row.nome),
    searchTokens: unique([normalize(row.nome), equipment(row), muscles.primary, ...normalize(row.nome).split(" ")]),
    classification: { source: "appdb-catalog-v1", confidence: 1 }, needsReview: false,
    video: { ...primaryVideo, variants }
  };
}).sort((a, b) => a.name.localeCompare(b.name, "en"));

mkdirSync(join(root, "catalog"), { recursive: true });
writeFileSync(output, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Catálogo criado: ${catalog.length} exercícios e ${rows.length} associações de vídeo em ${output}`);
