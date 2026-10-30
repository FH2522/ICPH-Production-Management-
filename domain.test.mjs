import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDemoAction, parseProjectText, singaporeDateTimeInput, fromSingaporeInput, duration } from '../src/domain.mjs';

function fixture() {
  return { beds: [{ bed_no: 1, status: 'available', active_cycle_id: null }],
    projects: [{ id: 1, code: '10108', name: 'Bedok N8C14' }], cycles: [], events: [], formulas: [] };
}
const at = i => new Date(Date.now() - 600000 + i * 60000).toISOString();

test('HCS lifecycle timestamps, curing auto-start, and archive after cut', () => {
  let d = fixture();
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(0), projectId: 1, heightMm: 200, strandPattern: '6T-9.53', castingLengthM: 110 });
  assert.equal(d.beds[0].status, 'preparation');
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_preparation', at: at(1) });
  assert.equal(d.beds[0].status, 'ready_casting');
  d = applyDemoAction(d, { bedNo: 1, action: 'start_casting', at: at(2) });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_casting', at: at(4) });
  assert.equal(d.beds[0].status, 'curing');
  assert.equal(d.cycles[0].curing_start, d.cycles[0].casting_end);
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_cut', at: at(6) }), /cube strength/i);
  d = applyDemoAction(d, { bedNo: 1, action: 'set_cube_strength', at: at(5), cubeStrengthMpa: 36.5 });
  d = applyDemoAction(d, { bedNo: 1, action: 'start_cut', at: at(6) });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_cut', at: at(7) });
  assert.equal(d.beds[0].status, 'available');
  assert.equal(d.beds[0].active_cycle_id, null);
  assert.equal(d.cycles[0].cut_end, at(7));
  assert.equal(d.events.length, 7);
});
test('invalid or out-of-order actions are refused', () => {
  let d = fixture();
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_casting', at: at(0) }), /Active batch not found/i);
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(2), projectId: 1, heightMm: 200, strandPattern: '5T', castingLengthM: 110 });
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'finish_preparation', at: at(1) }), /earlier/i);
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(3), projectId: 1, heightMm: 200, strandPattern: '5T', castingLengthM: 110 }), /not available/i);
});
test('new and existing project input', () => {
  const p = [{ id: 1, code: '10108', name: 'Bedok N8C14' }];
  assert.equal(parseProjectText('10108 - Bedok N8C14', p).project.id, 1);
  assert.deepEqual(parseProjectText('10200 - Site A', p).newProject, { code: '10200', name: 'Site A' });
  assert.throws(() => parseProjectText('foobar', p), /format/i);
});
test('Singapore operator inputs round-trip as +08 UTC instants', () => {
  assert.equal(fromSingaporeInput('2026-10-29T14:30'), '2026-10-29T06:30:00.000Z');
  assert.equal(singaporeDateTimeInput('2026-10-29T06:30:00.000Z'), '2026-10-29T14:30');
  assert.equal(duration(5400000), '1h 30m');
});

test('cannot backdate cut before the latest cube test, or backdate a cube update', () => {
  let d = fixture();
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(0), projectId: 1, heightMm: 200, strandPattern: '5T', castingLengthM: 110 });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_preparation', at: at(1) });
  d = applyDemoAction(d, { bedNo: 1, action: 'start_casting', at: at(2) });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_casting', at: at(3) });
  d = applyDemoAction(d, { bedNo: 1, action: 'set_cube_strength', at: at(6), cubeStrengthMpa: 38 });
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_cut', at: at(5) }), /earlier/i);
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'set_cube_strength', at: at(4), cubeStrengthMpa: 39 }), /earlier/i);
});

// v1.4 retroactive correction and step-reversal regression tests.
import { previousStep, validateArchivedEdit } from '../src/domain.mjs';
test('step rollback restores the immediately previous state and maintains cancellation audit', () => {
  const now = new Date(Date.now() - 1000).toISOString();
  const example = {
    beds: [{bed_no: 1,status:'cutting',active_cycle_id:'cycle-1'}],
    cycles: [{id:'cycle-1',bed_no:1,prep_start:now,prep_end:now,casting_start:now,casting_end:now,
      curing_start:now,cube_strength_mpa:40,cube_strength_updated_at:now,cut_start:now,cut_end:null}],
    events:[]
  };
  let d=previousStep(example,1);
  assert.equal(d.beds[0].status,'curing');
  assert.equal(d.cycles[0].cut_start,null);
  d=previousStep(d,1);
  assert.equal(d.beds[0].status,'casting');
  assert.equal(d.cycles[0].curing_start,null);
  assert.equal(d.cycles[0].cube_strength_mpa,null);
  d=previousStep(d,1);
  assert.equal(d.beds[0].status,'ready_casting');
  d=previousStep(d,1);
  assert.equal(d.beds[0].status,'preparation');
  d=previousStep(d,1);
  assert.equal(d.beds[0].status,'available');
  assert.ok(d.cycles[0].cancelled_at);
  assert.equal(d.events.length,5);
});

test('archived editing enforces chronological order including cube strength', () => {
  const t = Date.now() - 600000;
  const stamp = x => new Date(x).toISOString();
  const record = { height_mm:200, strand_pattern:'4D1', prep_start:stamp(t), prep_end:stamp(t+60000),
    casting_start:stamp(t+120000),casting_end:stamp(t+180000),curing_start:stamp(t+180000),
    cube_strength_updated_at:stamp(t+240000), cut_start:stamp(t+300000),cut_end:stamp(t+360000),cube_strength_mpa:40 };
  const corrected = validateArchivedEdit(record,{ cube_strength_mpa:45, casting_end:stamp(t+210000)});
  assert.equal(corrected.curing_start,stamp(t+210000));
  assert.throws(() => validateArchivedEdit(record,{cut_start:stamp(t+170000)}),/timestamps/);
  assert.throws(() => validateArchivedEdit(record,{cube_strength_updated_at:stamp(t+450000)}),/Cube test time/);
});
