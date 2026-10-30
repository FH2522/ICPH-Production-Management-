import { test } from 'node:test';
import assert from 'node:assert/strict';
import {computeMaterials,formulaRate,cycleMaterials,applyDemoAction,validateFormula,validateArchivedEdit} from '../src/domain.mjs';

test('length wastage percent, volume and steel material calculations',()=>{
  const a=computeMaterials({castingLengthM:110.25,bedLengthM:120,volumePerM:0.15,steelPerM:12});
  assert.equal(a.wastage_m,9.75);
  assert.equal(a.wastage_ratio,9.75/120);
  assert.ok(Math.abs(a.concrete_volume_m3-16.5375)<1e-9);
  assert.equal(a.steel_weight_kg,1323);
});
test('missing formula rates stay null, never invent default values',()=>{
  const a=computeMaterials({castingLengthM:110,bedLengthM:null,volumePerM:null,steelPerM:null});
  assert.equal(a.wastage_m,null);
  assert.equal(a.wastage_ratio,null);
  assert.equal(a.concrete_volume_m3,null);
  assert.equal(a.steel_weight_kg,null);
  assert.throws(()=>computeMaterials({castingLengthM:122,bedLengthM:120}),/cannot exceed/i);
  assert.throws(()=>computeMaterials({castingLengthM:0,bedLengthM:120}),/Casting Length/i);
});
test('formula key matching and validation',()=>{
  const rates=[{kind:'steel',key:'6T-9.53',rate:10.5},{kind:'bed_length',key:'2',rate:130},{kind:'volume',key:'200',rate:0.125}];
  assert.equal(formulaRate(rates,'steel',' 6t-9.53 '),10.5);
  assert.equal(formulaRate(rates,'bed_length',2),130);
  assert.equal(formulaRate(rates,'volume',200),0.125);
  assert.equal(validateFormula('steel',' 6t-9.53 ',11).key,'6T-9.53');
  assert.throws(()=>validateFormula('bed_length','6',122),/Bed 1/i);
  assert.throws(()=>validateFormula('volume','200',-1),/greater than 0/i);
});
test('new production snapshots settings before future edits',()=>{
  const data={beds:[{bed_no:1,status:'available',active_cycle_id:null}],projects:[{id:1,code:'A',name:'Demo'}],cycles:[],events:[],
    formulas:[{kind:'bed_length',key:'1',rate:120},{kind:'volume',key:'200',rate:0.13},{kind:'steel',key:'4T',rate:9.1}]};
  const p=applyDemoAction(data,{bedNo:1,action:'start_preparation',at:new Date(Date.now()-1000).toISOString(),projectId:1,heightMm:200,strandPattern:'4t',castingLengthM:110});
  const cycle=p.cycles[0];
  assert.equal(cycle.bed_length_m,120);
  assert.equal(cycle.concrete_m3_per_m,0.13);
  assert.equal(cycle.steel_kg_per_m,9.1);
  assert.equal(cycleMaterials(cycle).steel_weight_kg,1001);
  data.formulas[0].rate=200;
  assert.equal(cycleMaterials(cycle).wastage_m,10);
});
test('archived length correction checked against captured bed length',()=>{
  const t=Date.now()-600000;
  const iso=n=>new Date(t+n*60000).toISOString();
  const cycle={height_mm:200,strand_pattern:'4T',casting_length_m:110,bed_length_m:120,concrete_m3_per_m:0.12,steel_kg_per_m:10,
    prep_start:iso(0),prep_end:iso(1),casting_start:iso(2),casting_end:iso(3),curing_start:iso(3),cube_strength_updated_at:iso(4),cut_start:iso(5),cut_end:iso(6),cube_strength_mpa:40};
  assert.equal(cycleMaterials(validateArchivedEdit(cycle,{casting_length_m:115})).wastage_m,5);
  assert.throws(()=>validateArchivedEdit(cycle,{casting_length_m:121}),/cannot exceed/i);
});
