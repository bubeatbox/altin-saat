import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTr, wordAccuracy, speechRisk } from '../app/js/speech.js';
import { armRisk } from '../app/js/arm.js';
import { genelSeviye, bulguDurumu } from '../app/js/score.js';
// Browser APIs are only used inside functions; importing face.js needs no mocks.
import { yuzRisk } from '../app/js/face.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const speech = (overrides = {}) => ({ ok: true, accuracy: 1, wordsPerSec: 2.4, pauseRatio: 0.08, ...overrides });
const arm = (driftDeg, rotationDeg = 0) => ({ ok: true, driftDeg, rotationDeg });
const face = (isaretli, dinlenmeIsaretli = 0) => ({ ok: true, isaretli, dinlenmeIsaretli });

test('normalizeTr: dotted capital I', () => assert.equal(normalizeTr('İSTANBUL'), 'istanbul'));
test('normalizeTr: dotless capital I', () => assert.equal(normalizeTr('IŞIK'), 'ışık'));
test('normalizeTr: punctuation and whitespace', () => assert.equal(normalizeTr('  Merhaba,\n DÜNYA!  '), 'merhaba dünya'));
test('wordAccuracy: identical', () => assert.equal(wordAccuracy('annem taze ekmek aldı', 'annem taze ekmek aldı'), 1));
test('wordAccuracy: missing word', () => close(wordAccuracy('annem taze ekmek aldı', 'annem ekmek aldı'), 0.75));
test('wordAccuracy: swapped words count as two edits', () => close(wordAccuracy('annem taze ekmek aldı', 'annem ekmek taze aldı'), 0.5));
test('wordAccuracy: empty transcript', () => assert.equal(wordAccuracy('annem ekmek aldı', ''), 0));
test('wordAccuracy: punctuation difference', () => assert.equal(wordAccuracy('Bugün hava güzel!', 'Bugün, hava güzel.'), 1));
test('speechRisk: normal profile below 0.3', () => assert.ok(speechRisk(speech()) < 0.3));
test('speechRisk: broken profile at least 0.5', () => assert.ok(speechRisk(speech({ accuracy: 0.5, wordsPerSec: 1.1, pauseRatio: 0.35 })) >= 0.5));
test('speechRisk: null accuracy uses rate and pause', () => {
  close(speechRisk(speech({ accuracy: null, wordsPerSec: 1.5, pauseRatio: 0.275 })), 0.5);
  assert.equal(speechRisk(speech({ accuracy: null })), 0);
});
test('speechRisk: baseline relative rate and pause', () => {
  const baseline = speech({ wordsPerSec: 1.5, pauseRatio: 0.3 });
  assert.equal(speechRisk(baseline, baseline), 0);
  close(speechRisk(speech({ wordsPerSec: 0.75, pauseRatio: 0.55 }), baseline), 0.5);
});
test('speechRisk: zero baseline rate', () => assert.equal(speechRisk(speech({ wordsPerSec: 0 }), speech({ wordsPerSec: 0 })), 0));
test('speechRisk: failed result', () => assert.equal(speechRisk({ ok: false }), null));
// Eşikler 21 Kas kalibrasyonunda güncellendi: 3° altı sağlıklı, 10°'de tam risk.
test('armRisk: below thresholds', () => assert.equal(armRisk(arm(2.9, 2.9)), 0));
test('armRisk: large drift', () => assert.ok(armRisk(arm(12)) >= 0.5));
test('armRisk: baseline is subtracted', () => {
  assert.equal(armRisk(arm(12, 13), arm(12, 13)), 0);
  close(armRisk(arm(12, 13), arm(4, 5)), 5 / 7);
  assert.equal(armRisk(arm(2, 2), arm(12, 13)), 0);
});
test('armRisk: failed result', () => assert.equal(armRisk({ ok: false }), null));
test('genelSeviye: empty', () => assert.equal(genelSeviye({}), 'belirsiz'));
test('genelSeviye: ignores nulls', () => {
  assert.equal(genelSeviye({ yuz: null, kol: null }), 'belirsiz');
  assert.equal(genelSeviye({ yuz: null, kol: 0.1 }), 'dusuk');
});
test('genelSeviye: 0.5 is high', () => assert.equal(genelSeviye({ yuz: 0.5, kol: 0 }), 'yuksek'));
test('genelSeviye: 0.3 is medium', () => assert.equal(genelSeviye({ yuz: 0.3 }), 'orta'));
test('bulguDurumu: missing and threshold boundaries', () => {
  for (const v of [null, undefined]) assert.equal(bulguDurumu(v), 'belirsiz');
  for (const [v, expected] of [[0, 'yok'], [0.299, 'yok'], [0.3, 'sinirda'], [0.499, 'sinirda'], [0.5, 'var'], [1, 'var']]) assert.equal(bulguDurumu(v), expected);
});
test('yuzRisk: normal, smile asymmetry, resting asymmetry', () => {
  assert.equal(yuzRisk(face(0)), 0);
  assert.ok(yuzRisk(face(0.4)) >= 0.5);
  assert.ok(yuzRisk(face(0, 0.15)) >= 0.5);
});
test('yuzRisk: +0.4 baseline to -0.4 must be high', () => assert.ok(yuzRisk(face(-0.4), face(0.4)) >= 0.5));
test('yuzRisk: same side same value is zero', () => assert.equal(yuzRisk(face(0.4, 0.1), face(0.4, 0.1)), 0));
test('yuzRisk: failed result', () => assert.equal(yuzRisk({ ok: false }), null));
