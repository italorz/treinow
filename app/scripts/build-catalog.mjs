import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const videoDir = join(root, "videos");
const output = join(root, "catalog", "exercises.pt-BR.json");
const visualOverrides = JSON.parse(readFileSync(join(root, "catalog", "exercise-overrides.json"), "utf8"));

const equipmentCodes = {
  BB: "barra", DB: "halter", CB: "cabo", LV: "maquina", SM: "smith",
  KB: "kettlebell", BW: "peso_corporal", WT: "peso_corporal", EX: "peso_corporal", SB: "bola"
};
const equipmentWords = [
  ["barbell", "barra"], ["dumbbell", "halter"], ["cable", "cabo"], ["lever", "maquina"],
  ["machine", "maquina"], ["smith", "smith"], ["kettlebell", "kettlebell"], ["bodyweight", "peso_corporal"],
  ["plate", "anilha"], ["weightplate", "anilha"], ["band", "elastico"], ["bench", "banco"], ["ball", "bola"]
];
const rules = [
  ["core", "rotation", ["lyingcrossover"]],
  ["antebraco", "curl", ["wristcurl", "reversewrist", "wristextension", "wristflexion", "wristroller", "wristcircle", "forearm", "radialdeviation", "ulnardeviation", "ulnarflexion", "pronation", "supination", "gripper", "fingerextension", "extensor", "praying"]],
  ["pernas", "hinge", ["legcurl", "lyingleg", "seatedleg", "romaniandeadlift", "stiffleg", "straightlegdeadlift", "goodmorning", "glutehamraise", "hamstring"]],
  ["pernas", "extension", ["legextension", "assistedquad", "quadricep", "quadstretch"]],
  ["pernas", "squat", ["legpress", "hacksquat", "sissysquat"]],
  ["panturrilha", "raise", ["calfraise", "calf", "gastroc", "toeraise", "tibia", "anklecircle", "anklejump"]],
  ["triceps", "press", ["closegripbenchpress", "closegripinclinebench"]],
  ["costas", "pull", ["straightarmpulldown", "seatedstraightarmpulldown", "proneextension"]],
  ["ombro", "raise", ["reardelt", "rearlateral", "reversefly", "pushpress"]],
  ["peitoral", "press", ["benchpress", "chestpress", "pecdeck", "peckdeck", "pecfly", "chestfly", "crossover", "inclinepress", "declinepress", "inclinefly", "chestdip", "svend", "chest", "floorpress"]],
  ["peitoral", "press", ["pushup", "pressup"]],
  ["peitoral", "fly", ["fly", "flye"]],
  ["ombro", "raise", ["lateralraise", "frontraise", "sideraise", "reardelt", "rearlateral", "deltoid", "delt", "shoulderpress", "overheadpress", "militarypress", "arnoldpress", "uprightrow", "scaption", "facepull", "lraise", "yraise", "cubanpress", "shoulder", "armcircle", "armswing", "externalrotation", "internalrotation", "rotatorcuff", "handstand", "isopress", "protraction", "retraction", "shadowbox", "crossarm"]],
  ["trapezio", "shrug", ["shrug", "neck", "splenius", "trapez"]],
  ["costas", "pull", ["pulldown", "latpull", "pullup", "chinup", "pullover", "row", "deadlift", "backextension", "hyperexten", "superman", "birddog", "renegade", "backstretch", "backswing"]],
  ["gluteos", "hinge", ["glute", "hipthrust", "hipraise", "bridge", "hipexten", "hipabduction", "donkey", "frogpump", "kickbackglute", "pretzel", "piriformis", "clamshell", "kettlebellswing", "onearmswing", "doubleswing"]],
  ["biceps", "curl", ["bicepscurl", "hammercurl", "preachercurl", "concentrationcurl", "spidercurl", "inclinecurl", "curl", "biceps"]],
  ["triceps", "extension", ["triceps", "triext", "pushdown", "skullcrusher", "skull", "kickback", "overheadextension", "frenchpress", "closegrip", "dip"]],
  ["pernas", "squat", ["squat", "lunge", "stepup", "stepdown", "steptoe", "toetap", "splitsquat", "gobletsquat", "pistolsquat", "bulgarian", "wallsit", "wallsquat", "ironchair", "thruster", "jump", "leap", "bound", "highknee", "buttkick", "legswing", "legcircle", "legcycle", "leglift", "quadriceps", "hipadduction", "adductor", "adduction", "groin", "thigh", "shin", "itband", "shuffle", "skater", "straddle", "clean", "snatch", "jerk", "burpee", "footdrum", "legkick", "legsqueeze"]],
  ["core", "core", ["crunch", "situp", "plank", "twist", "sidebend", "lateralbend", "russiantwist", "legraise", "kneeraise", "kneein", "kneepull", "kneetouch", "abwheel", "abroller", "mountainclimber", "hollow", "vup", "flutterkick", "bicycle", "oblique", "deadbug", "windshield", "toestobar", "heeltouch", "toetouch", "toereach", "reachtoe", "wiper", "pike", "lsit", "scissors", "hanging", "windmill", "woodchopper", "overheadchop", "figure8", "bearcrawl", "crabcrawl", "jackknife", "scissorkick", "tablemaker", "broomstick", "waist", "abdominal", "standingab", "supineab", "leanback", "buttups", "passoff", "objectssqueeze", "objectsqueeze", "bentkneehold", "balance"]],
  ["ombro", "press", ["press", "raise"]]
];
const pt = [
  [/stretch/gi, "Alongamento"], [/dumbbell|db/gi, "com halteres"], [/barbell|bb/gi, "com barra"],
  [/cable|cb/gi, "no cabo"], [/bodyweight|bw/gi, "com peso corporal"], [/lateral raise/gi, "elevação lateral"],
  [/front raise/gi, "elevação frontal"], [/bench press/gi, "supino"], [/push up/gi, "flexão"],
  [/pull up/gi, "barra fixa"], [/chin up/gi, "barra fixa supinada"], [/squat/gi, "agachamento"],
  [/lunge/gi, "avanço"], [/deadlift/gi, "levantamento terra"], [/row/gi, "remada"],
  [/lying crossover/gi, "rotação cruzada deitada"],
  [/curl/gi, "rosca"], [/extension/gi, "extensão"], [/press/gi, "desenvolvimento"],
  [/calf raise/gi, "elevação de panturrilha"], [/hip raise/gi, "elevação de quadril"],
  [/shoulder/gi, "ombro"], [/chest/gi, "peitoral"], [/leg/gi, "perna"]
];

function splitName(file) {
  return basename(file, ".mp4").replace(/^\d+[-_]?/, "").replace(/^(BB|DB|CB|LV|SM|KB|BW|WT|EX|SB)(?=[A-Z])/i, "$1 ").replace(/(?:_?Textured|_?Texture|_?Full|_?begin|_?loop|8)$/gi, "")
    .replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}
function normalize(v) { return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function overrideKey(raw) {
  return raw.toLowerCase()
    .replace(/\.mov_(begin|loop)$/i, "")
    .replace(/_(begin|loop)$/i, "");
}
function equipment(raw, spaced) {
  const prefix = raw.replace(/^\d+[-_]?/, "").slice(0, 2);
  if (equipmentCodes[prefix]) return equipmentCodes[prefix];
  const hay = normalize(spaced).replaceAll(" ", "");
  return equipmentWords.find(([word]) => hay.includes(word))?.[1] ?? "peso_corporal";
}
function classify(spaced) {
  const hay = normalize(spaced).replaceAll(" ", "");
  const match = rules.find(([, , words]) => words.some(w => hay.includes(normalize(w).replaceAll(" ", ""))));
  return match ? { musclePrimary: match[0], movementPattern: match[1], confidence: 0.9 } : { musclePrimary: "core", movementPattern: "outro", confidence: 0.35 };
}
function localizedName(spaced, eq) {
  let name = spaced.replace(/^(BB|DB|CB|LV|SM|KB|BW|WT|EX|SB)\s+/i, "");
  for (const [pattern, value] of pt) name = name.replace(pattern, value);
  name = name.replace(/\braise\b/gi, "elevação").replace(/\bside bend\b/gi, "flexão lateral").replace(/\btwist\b/gi, "rotação");
  name = name.replace(/\b(BB|DB|CB|LV|BW|WT|FM|NPL|V\d)\b/gi, "").replace(/\s+/g, " ").trim();
  const suffix = { halter: " com halteres", barra: " com barra", cabo: " no cabo", maquina: " na máquina", smith: " no smith", kettlebell: " com kettlebell", elastico: " com elástico" }[eq] ?? "";
  if (suffix && !normalize(name).includes(normalize(suffix))) name += suffix;
  return name ? name[0].toUpperCase() + name.slice(1).toLowerCase() : "Exercício";
}
function joints(muscle) {
  return {
    ombro: ["ombro"], peitoral: ["ombro", "cotovelo"], costas: ["ombro", "cotovelo"],
    biceps: ["cotovelo"], triceps: ["cotovelo"], antebraco: ["punho", "cotovelo"],
    pernas: ["quadril", "joelho"], gluteos: ["quadril", "coluna_lombar"],
    panturrilha: ["tornozelo"], core: ["coluna_lombar"], trapezio: ["coluna_cervical", "ombro"]
  }[muscle] ?? [];
}
function secondaryMuscles(muscle, isStretch) {
  if (isStretch) return [];
  return {
    peitoral: ["triceps", "ombro"],
    costas: ["biceps", "trapezio"],
    ombro: ["triceps", "trapezio"],
    biceps: ["antebraco"],
    triceps: ["ombro"],
    gluteos: ["pernas", "core"],
    pernas: ["gluteos", "core"],
    panturrilha: ["pernas"],
    trapezio: ["ombro"],
    antebraco: ["biceps"],
    core: []
  }[muscle] ?? [];
}
function targetKey(raw, muscle, pattern) {
  const hay = normalize(raw).replaceAll(" ", "");
  if (muscle === "ombro") {
    if (/reardelt|rearlateral|reversefly/.test(hay)) return "ombro_cabeca_posterior";
    if (/lateralraise|sideraise|ironcross/.test(hay)) return "ombro_cabeca_lateral";
    if (/frontraise/.test(hay)) return "ombro_cabeca_anterior";
    if (/externalrotation|extrot|rotatorcuff/.test(hay)) return "manguito_rotador_externo";
    if (/internalrotation|introt/.test(hay)) return "manguito_rotador_interno";
    if (/press|military|arnold|handstand/.test(hay)) return "ombro_desenvolvimento";
    return "ombro_geral";
  }
  if (muscle === "peitoral") {
    if (/incline/.test(hay)) return "peitoral_superior";
    if (/decline|chestdip/.test(hay)) return "peitoral_inferior";
    if (/fly|crossover/.test(hay)) return "peitoral_aducao";
    return "peitoral_horizontal";
  }
  if (muscle === "costas") {
    if (/pulldown|pullup|chinup|pullover/.test(hay)) return "costas_puxada_vertical";
    if (/row/.test(hay)) return "costas_remada_horizontal";
    if (/extension|superman|goodmorning/.test(hay)) return "costas_extensao";
    return "costas_geral";
  }
  if (muscle === "pernas") {
    if (/legcurl|hamstring|stiffleg|straightleg|romanian/.test(hay)) return "posterior_coxa";
    if (/adduct|groin|legsquee/.test(hay)) return "adutores";
    if (/legextension|quad/.test(hay)) return "quadriceps_extensao";
    if (/lunge|step/.test(hay)) return "pernas_unilateral";
    return "quadriceps_agachamento";
  }
  if (muscle === "gluteos") return /abduction|clamshell/.test(hay) ? "gluteo_medio" : "gluteo_maximo";
  if (muscle === "core") {
    if (/twist|rotation|woodchop|figure8|sidebend/.test(hay)) return "core_rotacao";
    if (/plank|stability|hold/.test(hay)) return "core_estabilidade";
    return "core_flexao";
  }
  return `${muscle}_${pattern}`;
}
function meta(path) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,duration", "-of", "json", path], { encoding: "utf8" });
    const s = JSON.parse(out).streams?.[0] ?? {};
    return { codec: s.codec_name ?? "unknown", width: Number(s.width ?? 0), height: Number(s.height ?? 0), durationSeconds: Number(Number(s.duration ?? 0).toFixed(3)) };
  } catch { return { codec: "unknown", width: 0, height: 0, durationSeconds: 0 }; }
}

const files = readdirSync(videoDir).filter(f => f.toLowerCase().endsWith(".mp4")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const catalog = files.map(fileName => {
  const full = join(videoDir, fileName);
  const raw = basename(fileName, ".mp4");
  const spaced = splitName(fileName);
  const visual = visualOverrides[overrideKey(raw)];
  const c = visual ? { musclePrimary: visual.muscle, movementPattern: visual.pattern, confidence: 0.98 } : classify(spaced);
  const eq = equipment(raw, spaced);
  const isStretch = visual?.isStretch ?? /stretch|mobility|circle|warm/i.test(spaced);
  const isUnilateral = /single|one arm|one leg|alternat|(^|[_ -])SL/i.test(raw);
  const highAwareness = /lateral|rear delt|fly|adduct|abduct|isometric|iso/i.test(spaced);
  const complex = /clean|snatch|jerk|handstand|plyo|single leg deadlift/i.test(spaced) ? "avancado" : /deadlift|lunge|pulldown|bench|single/i.test(spaced) ? "intermediario" : "iniciante";
  const name = visual?.name ?? localizedName(spaced, eq);
  const target = targetKey(raw, c.musclePrimary, c.movementPattern);
  const warmupEligible = isStretch || target.startsWith("manguito_rotador_") || /circle|mobility|arm\s*swings?|external\s*rotation|internal\s*rotation|ext\s*rot|int\s*rot|rotator\s*cuff/i.test(spaced);
  const searchTokens = [...new Set([normalize(name), normalize(spaced), eq, c.musclePrimary, ...normalize(name).split(" ")])];
  const involvedJoints = visual?.joints ?? (/lying\s*crossover/i.test(spaced) ? ["quadril", "coluna_lombar"] : joints(c.musclePrimary));
  return {
    slug: normalize(raw).replaceAll(" ", "-"), locale: "pt-BR", name, nameRaw: raw,
    musclePrimary: c.musclePrimary, secondaryMuscles: secondaryMuscles(c.musclePrimary, isStretch), equipment: eq, complexity: complex,
    movementPattern: c.movementPattern, targetKey: target, isUnilateral, isStretch, isWarmup: warmupEligible,
    joints: involvedJoints, contraindications: involvedJoints,
    requiresHighMindMuscleAwareness: highAwareness, searchTokens,
    classification: { source: visual ? "codex-visual-review-v1" : "codex-curated-rules-v2", confidence: c.confidence, reviewedAt: new Date().toISOString() },
    needsReview: c.confidence < 0.6,
    video: { fileName, objectKey: `exercises/${fileName}`, sha256: createHash("sha256").update(readFileSync(full)).digest("hex"), ...meta(full) }
  };
});

mkdirSync(join(root, "catalog"), { recursive: true });
writeFileSync(output, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Catálogo criado: ${catalog.length} exercícios em ${output}`);
