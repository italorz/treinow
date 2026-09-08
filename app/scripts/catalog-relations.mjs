// Source facts remain separate from derived planning rules.
export const VERSION = 'appdb-catalog-v2';
export const muscleMap = {Abs:'core',Chest:'peitoral',Lats:'costas',Shoulders:'ombro',Biceps:'biceps',Triceps:'triceps',Forearms:'antebraco',Traps:'trapezio',Glutes:'gluteos',Hamstrings:'pernas',Quads:'pernas',Calves:'panturrilha'};
export const equipmentMap = {'Body weight':'peso_corporal',Dumbbell:'halter',Cable:'cabo',Barbell:'barra','EZ Barbell':'barra','Trap bar':'barra','Leverage machine':'maquina','Special Machine':'maquina','Sled machine':'maquina',Treadmill:'maquina','Smith machine':'smith',Band:'elastico','Resistance Band':'elastico',Kettlebell:'kettlebell','Stability ball':'bola','Medicine Ball':'bola',Rollball:'bola','Bosu ball':'bola','Special Bench':'banco',Weighted:'anilha',Suspension:'suspensao','Special Bar':'barra_fixa','Foam Roller':'rolo',Landmine:'landmine',Stick:'bastao',Rope:'corda','Power Sled':'treno','Ab Wheel Roller':'roda_abdominal','Vibrate Plate':'plataforma_vibratoria','Special Equipment':'outro','Head Harness':'cinta_cabeca'};
export const normalize = v => v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const unique = values => [...new Set(values.filter(Boolean))];

export function musclesFor(rows) {
  if (!rows.length || rows.some(r => !muscleMap[r.muscle])) throw Error('Missing or unknown muscle relation');
  const sorted = [...rows].sort((a,b) => b.isTarget-a.isTarget || b.musclePercentage-a.musclePercentage || a.muscle.localeCompare(b.muscle));
  const targets = sorted.filter(r => r.isTarget);
  if (!targets.length) throw Error('Exercise without target muscles');
  return {primary:muscleMap[targets[0].muscle], targets:unique(targets.map(r=>muscleMap[r.muscle])),
    secondary:unique(sorted.filter(r=>!r.isTarget).map(r=>muscleMap[r.muscle])),
    relations:sorted.map(r=>({muscle:r.muscle,group:muscleMap[r.muscle],isTarget:Boolean(r.isTarget),participation:r.musclePercentage}))};
}

export function targetFor(name, muscle, type, id) {
  const n=normalize(name).replaceAll(' ','');
  if (type==='Stretching') return `${muscle}_alongamento`;
  if (type==='Aerobic') return `${muscle}_aerobico`;
  if (muscle==='ombro') {
    if (/externalrotation|rotatorcuff/.test(n)) return 'manguito_rotador_externo';
    if (/internalrotation/.test(n)) return 'manguito_rotador_interno';
    if (/rear|reversefly/.test(n)) return 'ombro_cabeca_posterior';
    if (/lateralraise|sideraise/.test(n)) return 'ombro_cabeca_lateral';
    if (/frontraise/.test(n)) return 'ombro_cabeca_anterior';
    if (/press|handstandpush/.test(n)) return 'ombro_desenvolvimento';
    if (/uprightrow/.test(n)) return 'ombro_remada_alta';
  }
  if (muscle==='peitoral') {
    const plane=/incline/.test(n)?'superior':/decline|chestdip/.test(n)?'inferior':'horizontal';
    if (/fly|crossover/.test(n)) return `peitoral_aducao_${plane}`;
    if (/press|pushup|dip/.test(n)) return `peitoral_press_${plane}`;
  }
  if (muscle==='costas') {
    if (/row/.test(n)) return 'costas_remada_horizontal';
    if (/pullup|chinup|pulldown/.test(n)) return 'costas_puxada_vertical';
    if (/pullover/.test(n)) return 'costas_pullover';
    if (/extension|superman|goodmorning/.test(n)) return 'costas_extensao';
  }
  if (/legcurl/.test(n)) return 'posterior_coxa_flexao';
  if (/romanian|stiffleg|straightlegdeadlift/.test(n)) return 'posterior_coxa_hinge';
  if (/legextension/.test(n)) return 'quadriceps_extensao';
  if (['pernas','gluteos'].includes(muscle)) {
    if (/abduction|clamshell/.test(n)) return 'gluteo_medio';
    if (/adduction/.test(n)) return 'adutores';
    if (/hipthrust|bridge|hip[ae]xtension|kickback|donkey/.test(n)) return 'gluteo_extensao_quadril';
    if (/lunge|stepup|splitsquat/.test(n)) return 'pernas_unilateral';
    if (/squat|legpress/.test(n)) return 'pernas_agachamento';
    if (/deadlift|goodmorning/.test(n)) return 'pernas_hinge';
  }
  if (muscle==='biceps' && /curl/.test(n)) return /hammer|neutral/.test(n)?'biceps_neutro':'biceps_flexao';
  if (muscle==='triceps' && /extension|pushdown|kickback/.test(n)) return 'triceps_extensao';
  if (muscle==='triceps' && /press|pushup|dip/.test(n)) return 'triceps_press';
  if (muscle==='trapezio' && /shrug/.test(n)) return 'trapezio_elevacao';
  if (muscle==='panturrilha' && /calfraise|calfpress/.test(n)) return /seated/.test(n)?'panturrilha_sentado':'panturrilha_em_pe';
  if (muscle==='antebraco') {
    if (/reverse.*curl|extension/.test(n)) return 'antebraco_extensao';
    if (/curl|flexion/.test(n)) return 'antebraco_flexao';
    if (/pronation/.test(n)) return 'antebraco_pronacao';
    if (/supination/.test(n)) return 'antebraco_supinacao';
  }
  if (muscle==='core') {
    if (/twist|rotation|woodchop/.test(n)) return 'core_rotacao';
    if (/sidebend/.test(n)) return 'core_flexao_lateral';
    if (/plank|hold|deadbug/.test(n)) return 'core_estabilidade';
    if (/crunch|situp|vup/.test(n)) return 'core_flexao';
    if (/legraise|kneeraise/.test(n)) return 'core_elevacao_pernas';
    if (/rollout/.test(n)) return 'core_antiextensao';
  }
  // Unknown movements must never become equivalent solely through a broad muscle label.
  return `individual_${id.slice(0,40)}`;
}

export function enrich(source, muscleRows) {
  const muscles=musclesFor(muscleRows);
  // The source only says "weighted", not which kind of external load.
  const equipment=source.equipment==='Weighted'?'carga_adicional':equipmentMap[source.equipment];
  const secondary=source.secondaryEquipment?equipmentMap[source.secondaryEquipment]:null;
  if (!equipment || (source.secondaryEquipment && !secondary)) throw Error(`Unknown equipment: ${source.equipment}/${source.secondaryEquipment}`);
  const target=targetFor(source.name,muscles.primary,source.exerciseType,source.exerciseId);
  return {muscles,equipment,target,
    knowledge:{sourceExerciseId:source.exerciseId,exerciseType:source.exerciseType,
      equipment:{primary:source.equipment,secondary:source.secondaryEquipment,required:unique([equipment,secondary])},
      targetMuscles:muscles.targets,muscleRelations:muscles.relations,
      measurement:{weight:Boolean(source.isWeight),repetitions:Boolean(source.isRep),distance:Boolean(source.isDistance),duration:Boolean(source.isDuration)},
      sourceScores:{popularity:source.popularityScore,gpt:source.gptScore,experience:source.gptExperience},
      substitution:{key:target,method:'name-rules-v2',eligible:source.exerciseType==='Strength'&&!target.startsWith('individual_')},
      provenance:{muscles:'AppDb1/ExerciseMuscleEntity',exercise:'AppDb1/ExerciseEntity',videos:'videos_identificados.csv',categories:'exercicios_por_categoria.csv'}}};
}
