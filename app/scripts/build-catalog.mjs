import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {VERSION,enrich,normalize,unique} from './catalog-relations.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const sourceDir=join(root,'packages/acervo-videos/catalogo');
const videoDir=join(root,'packages/acervo-videos/HD/Sem categoria');
const output=join(root,'catalog/exercises.pt-BR.json');
const translations=JSON.parse(readFileSync(join(root,'catalog/names.pt-BR.json'),'utf8'));
const translationOverrides=JSON.parse(readFileSync(join(root,'catalog/name-overrides.pt-BR.json'),'utf8'));
export function parseCsv(text) {
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(c==='"'&&text[i+1]==='"'){field+='"';i++;} else if(c==='"')quoted=false;else field+=c; }
    else if(c==='"')quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Unterminated CSV field');
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift().map(v=>v.replace(/^\uFEFF/,''));
  return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw Error('CSV column mismatch');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
const readCsv=name=>parseCsv(readFileSync(join(sourceDir,name),'utf8'));
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const cached=new Map();
if(existsSync(output))for(const e of JSON.parse(readFileSync(output,'utf8')))for(const v of Object.values(e.video.variants??{}))cached.set(v.fileName,v);
function videoMeta(fileName,videoId,gender) {
  if(!/^[a-zA-Z0-9_]+\.mp4$/.test(fileName))throw Error(`Invalid video filename ${fileName}`);
  const path=join(videoDir,fileName),sha256=digest(path),old=cached.get(fileName);
  let meta=old?.sha256===sha256?old:null;
  if(!meta || !meta.width || !meta.durationSeconds) {
    const out=execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,duration','-of','json',path],{encoding:'utf8'});
    const s=JSON.parse(out).streams[0];
    meta={codec:s.codec_name,width:s.width,height:s.height,durationSeconds:Number(Number(s.duration).toFixed(3))};
  }
  return {...meta,fileName,objectKey:`exercises/${fileName}`,sha256,sourceVideoId:videoId,gender};
}
const db=new DatabaseSync(join(sourceDir,'AppDb1'),{readOnly:true});
const source=db.prepare('SELECT * FROM ExerciseEntity ORDER BY exerciseId').all();
const muscleQuery=db.prepare('SELECT muscle,isTarget,musclePercentage FROM ExerciseMuscleEntity WHERE exerciseId=?');
const categoryRows=readCsv('exercicios_por_categoria.csv');
const categories=new Map(categoryRows.map(r=>[r.exercise_id,r]));
if(categories.size!==categoryRows.length || categories.size!==source.length)throw Error('Category coverage/duplicate mismatch');
const videoRows=readCsv('videos_identificados.csv');
const videos=new Map();
for(const row of videoRows) {
  if(row.arquivo_encontrado!=='sim')throw Error(`Source video unavailable ${row.video_id}`);
  if(!['masculino','feminino'].includes(row.genero_video))throw Error('Unknown video gender');
  const list=videos.get(row.exercise_id)??[]; list.push(row);videos.set(row.exercise_id,list);
}
if(videos.size!==source.length)throw Error('Video exercise coverage mismatch');
const jointsFor=m=>({ombro:['ombro'],peitoral:['ombro','cotovelo'],costas:['ombro','cotovelo'],biceps:['cotovelo'],triceps:['cotovelo'],antebraco:['punho','cotovelo'],pernas:['quadril','joelho'],gluteos:['quadril','coluna_lombar'],panturrilha:['tornozelo'],core:['coluna_lombar'],trapezio:['coluna_cervical','ombro']}[m]??[]);
const catalog=source.map(s=>{
  const c=categories.get(s.exerciseId),muscleRows=muscleQuery.all(s.exerciseId);
  const targetNames=muscleRows.filter(m=>m.isTarget).map(m=>m.muscle).sort().join('|');
  for(const [key,val] of Object.entries({nome:s.name,tipo:s.exerciseType,equipamento:s.equipment,equipamento_secundario:s.secondaryEquipment??'',musculos_alvo:targetNames,male_id:String(s.maleId??''),female_id:String(s.femaleId??'')}))if(c?.[key]!==val)throw Error(`Category mismatch ${s.name}: ${key}`);
  const variants={};
  for(const r of videos.get(s.exerciseId)??[]) {
    for(const key of ['nome','tipo','equipamento','equipamento_secundario','musculos_alvo'])if(r[key]!==c[key])throw Error(`Video/category mismatch ${s.name}: ${key}`);
    const expected=r.genero_video==='masculino'?s.maleId:s.femaleId;
    if(String(expected)!==r.video_id || variants[r.genero_video])throw Error(`Video ID/duplicate mismatch ${s.name}`);
    variants[r.genero_video]=videoMeta(r.arquivo_mp4,r.video_id,r.genero_video);
  }
  for(const [g,id] of [['masculino',s.maleId],['feminino',s.femaleId]])if(id&&!variants[g])throw Error(`Missing variant ${s.name}/${g}`);
  const {muscles,equipment,target,knowledge}=enrich(s,muscleRows);
  const isStretch=s.exerciseType==='Stretching';
  const warm=isStretch||target.startsWith('manguito_rotador_')||/arm circles?|arm swings?/i.test(s.name);
  const joints=unique([muscles.primary,...muscles.targets].flatMap(jointsFor));
  const name=translationOverrides[s.name]??translations[s.exerciseId];
  if(typeof name!=='string'||name.length<3||name.length>160)throw Error(`Missing/invalid Portuguese name ${s.exerciseId}`);
  return {slug:s.exerciseId,locale:'pt-BR',name,nameRaw:s.name,musclePrimary:muscles.primary,
    secondaryMuscles:muscles.secondary,equipment,complexity:s.gptExperience<=2?'iniciante':s.gptExperience<=4?'intermediario':'avancado',
    movementPattern:(target.startsWith('individual_')?'outro':target.split('_').slice(1).join('_')||target).slice(0,32),targetKey:target,
    isUnilateral:/single|one arm|one leg|unilateral|alternat/i.test(s.name),isStretch,isWarmup:warm,
    joints,contraindications:joints,requiresHighMindMuscleAwareness:/fly|raise|isometric|abduction|adduction/i.test(s.name),
    searchTokens:unique([normalize(name),...normalize(name).split(' '),normalize(s.name),...normalize(s.name).split(' '),equipment,...muscles.targets,...muscles.secondary,normalize(s.equipment)]),
    classification:{source:VERSION,primaryMuscleMethod:'target-highest-source-participation; alphabetical-tie-break',derivedFields:['targetKey','complexity','joints','contraindications','isWarmup'],knowledge},
    needsReview:false,video:{...(variants.masculino??variants.feminino),variants}};
}).sort((a,b)=>a.slug.localeCompare(b.slug));
db.close();
if(Object.keys(translations).length!==catalog.length)throw Error('Portuguese name coverage mismatch');
const orphanRows=readCsv('videos_sem_relacao.csv');
const manifest={version:VERSION,exercises:catalog.length,videoAssociations:videoRows.length,uniqueVideos:new Set(videoRows.map(r=>r.arquivo_mp4)).size,
  muscleRelations:catalog.reduce((n,e)=>n+e.classification.knowledge.muscleRelations.length,0),
  sourceHashes:Object.fromEntries(['AppDb1','exercicios_por_categoria.csv','videos_identificados.csv','videos_sem_relacao.csv'].map(f=>[f,digest(join(sourceDir,f))])),
  unlinkedVideos:orphanRows.length,automaticSubstitution:catalog.filter(e=>e.classification.knowledge.substitution.eligible&&!e.isWarmup).length,
  removedUnlinkedVideoFiles:orphanRows.length,
  translatedNames:catalog.length,translationHash:digest(join(root,'catalog/names.pt-BR.json')),
  translationOverridesHash:digest(join(root,'catalog/name-overrides.pt-BR.json')),
  note:'Portuguese display names; original names kept only as provenance/search. Muscle participation preserved. Derived rules are not clinical validation. Unlinked source rows are documented, but their video files are removed.'};
mkdirSync(join(root,'catalog'),{recursive:true});
writeFileSync(output,JSON.stringify(catalog,null,2)+'\n');
writeFileSync(join(root,'catalog/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
