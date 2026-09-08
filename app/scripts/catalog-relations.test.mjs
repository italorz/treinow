import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {musclesFor,targetFor} from './catalog-relations.mjs';

test('primary uses target participation; assistants remain separate',()=>{
  const result=musclesFor([{muscle:'Abs',isTarget:0,musclePercentage:.2},{muscle:'Chest',isTarget:1,musclePercentage:.3},{muscle:'Shoulders',isTarget:1,musclePercentage:.5}]);
  assert.equal(result.primary,'ombro');
  assert.deepEqual(result.targets,['ombro','peitoral']);
  assert.deepEqual(result.secondary,['core']);
});
test('front and lateral raises, presses and flyes cannot be equivalent',()=>{
  assert.notEqual(targetFor('Dumbbell Front Raise','ombro','Strength','x'),targetFor('Dumbbell Lateral Raise','ombro','Strength','y'));
  assert.notEqual(targetFor('Barbell Bench Press','peitoral','Strength','x'),targetFor('Dumbbell Fly','peitoral','Strength','y'));
  assert.equal(targetFor('Dumbbell Lateral Raise','ombro','Strength','x'),targetFor('Cable Lateral Raise','ombro','Strength','y'));
  assert.notEqual(targetFor('Unrecognized movement','core','Strength','x'),targetFor('Another movement','core','Strength','y'));
});
test('whole catalog exposes all original muscle relations and both video IDs',()=>{
  const rows=JSON.parse(readFileSync(new URL('../catalog/exercises.pt-BR.json',import.meta.url),'utf8'));
  assert.equal(rows.length,3001);
  assert.equal(rows.reduce((n,r)=>n+r.classification.knowledge.muscleRelations.length,0),9001);
  assert.equal(rows.reduce((n,r)=>n+Object.keys(r.video.variants).length,0),3792);
  const press=rows.find(r=>r.nameRaw==='Barbell Bench Press');
  assert.equal(press.name.toLocaleLowerCase('pt-BR'),'supino com barra');
  assert.deepEqual(press.secondaryMuscles,['ombro','triceps']);
  assert.equal(press.video.variants.masculino.sourceVideoId,'2512');
  assert.equal(press.video.variants.feminino.sourceVideoId,'244012');
  const extra=rows.find(r=>r.classification.knowledge.equipment.secondary==='Stability ball');
  assert.ok(extra.classification.knowledge.equipment.required.includes('bola'));
});

test('Portuguese names cover the new source IDs without changing provenance',()=>{
  const rows=JSON.parse(readFileSync(new URL('../catalog/exercises.pt-BR.json',import.meta.url),'utf8'));
  const names=JSON.parse(readFileSync(new URL('../catalog/names.pt-BR.json',import.meta.url),'utf8'));
  const overrides=JSON.parse(readFileSync(new URL('../catalog/name-overrides.pt-BR.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(names).length,3001);
  for(const row of rows){
    assert.equal(row.name,overrides[row.nameRaw]??names[row.slug]);
    assert.ok(row.name.length<=160 && row.name.length>=3);
    assert.ok(row.nameRaw);
    assert.equal(row.locale,'pt-BR');
    assert.doesNotMatch(row.name,/\b(dumbbell|barbell|bodyweight|lying|standing|seated|push-up|pull-up|stretch|raise|curl)\b/i);
  }
});
