import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const catalog = JSON.parse(readFileSync(join(root, "catalog", "exercises.pt-BR.json"), "utf8"));
const videoDir = join(root, "packages", "acervo-videos", "HD", "Sem categoria");
const failures = [];
const slugs = new Set();
const videoFiles = new Set();

for (const item of catalog) {
  if (slugs.has(item.slug)) failures.push(`${item.slug}: slug duplicado`);
  slugs.add(item.slug);
  if (item.needsReview) failures.push(`${item.nameRaw}: revisão pendente`);
  if (!item.name || !item.musclePrimary || !item.movementPattern || !item.equipment || !item.video?.objectKey) failures.push(`${item.nameRaw}: metadados obrigatórios ausentes`);
  const variants = Object.values(item.video?.variants ?? { padrao: item.video });
  for (const video of variants) {
    if (!video?.fileName || !existsSync(join(videoDir, video.fileName))) failures.push(`${item.nameRaw}: vídeo ${video?.fileName ?? "sem nome"} ausente`);
    else videoFiles.add(video.fileName);
    if (!video?.sha256) failures.push(`${item.nameRaw}: hash do vídeo ausente`);
  }
}

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
if (catalog.length !== 3001 || videoFiles.size !== 3791) {
  console.error(`Totais inesperados: ${catalog.length} exercícios e ${videoFiles.size} vídeos únicos`);
  process.exit(1);
}
const physicalVideos = readdirSync(videoDir).filter(name => name.toLowerCase().endsWith('.mp4'));
const extras = physicalVideos.filter(name => !videoFiles.has(name));
if (physicalVideos.length !== videoFiles.size || extras.length) {
  console.error(`Arquivos fora da nova relação: ${extras.length}; físicos=${physicalVideos.length}; relacionados=${videoFiles.size}`);
  process.exit(1);
}
console.log(`Catálogo verificado: ${catalog.length} exercícios, ${videoFiles.size} vídeos únicos e nenhuma pendência.`);
