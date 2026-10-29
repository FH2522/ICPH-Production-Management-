import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDemoAction, parseProjectText, singaporeDateTimeInput, fromSingaporeInput, duration } from '../src/domain.mjs';

function fixture() {
  return { beds: [{ bed_no: 1, status: 'available', active_cycle_id: null }],
    projects: [{ id: 1, code: '10108', name: 'Bedok N8C14' }], cycles: [], events: [] };
}
const at = i => new Date(Date.now() - 600000 + i * 60000).toISOString();

test('HCS lifecycle timestamps, curing auto-start, and archive after cut', () => {
  let d = fixture();
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(0), projectId: 1, heightMm: 200, strandPattern: '6T-9.53' });
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
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(2), projectId: 1, heightMm: 200, strandPattern: '5T' });
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'finish_preparation', at: at(1) }), /earlier/i);
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(3), projectId: 1, heightMm: 200, strandPattern: '5T' }), /not available/i);
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
  d = applyDemoAction(d, { bedNo: 1, action: 'start_preparation', at: at(0), projectId: 1, heightMm: 200, strandPattern: '5T' });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_preparation', at: at(1) });
  d = applyDemoAction(d, { bedNo: 1, action: 'start_casting', at: at(2) });
  d = applyDemoAction(d, { bedNo: 1, action: 'finish_casting', at: at(3) });
  d = applyDemoAction(d, { bedNo: 1, action: 'set_cube_strength', at: at(6), cubeStrengthMpa: 38 });
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'start_cut', at: at(5) }), /earlier/i);
  assert.throws(() => applyDemoAction(d, { bedNo: 1, action: 'set_cube_strength', at: at(4), cubeStrengthMpa: 39 }), /earlier/i);
});
