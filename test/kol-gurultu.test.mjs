import test from 'node:test';
import assert from 'node:assert/strict';
import { runArmTest, armRisk } from '../app/js/arm.js';

// Tests the real sensor path, NOT a copy of calculate(). No real waits.
// Fixed seeds make every failing trial reproducible. Synthetic rates are not
// clinical sensitivity/specificity estimates.
const SEED = 0xA1715AA7;
const N = 200;
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}
function gaussian(random) {
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}
const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;

function fakeClock() {
  let now = 0, id = 0;
  const jobs = new Map(), listeners = new Set(), originals = new Map();
  function replace(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const schedule = (fn, delay, interval, args = []) => {
    const key = ++id;
    jobs.set(key, { fn, at: now + Math.max(1e-6, delay), interval, args });
    return key;
  };
  const dateNow = Object.getOwnPropertyDescriptor(Date, 'now');
  replace('performance', { now: () => now });
  Object.defineProperty(Date, 'now', { configurable: true, writable: true, value: () => 1700000000000 + now });
  replace('window', {
    DeviceOrientationEvent: class {},
    addEventListener(type, fn) { if (type === 'deviceorientation') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'deviceorientation') listeners.delete(fn); },
  });
  replace('setTimeout', (fn, delay = 0, ...args) => schedule(fn, delay, 0, args));
  replace('setInterval', (fn, delay = 0, ...args) => schedule(fn, delay, Math.max(1e-6, delay), args));
  replace('clearTimeout', key => jobs.delete(key));
  replace('clearInterval', key => jobs.delete(key));
  replace('requestAnimationFrame', fn => schedule(() => fn(now), 1000 / 60, 0));
  replace('cancelAnimationFrame', key => jobs.delete(key));
  return {
    advance(target) {
      assert.ok(target >= now);
      let guard = 0;
      while (true) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++guard < 100000, 'fake timer runaway');
        const [key, job] = next;
        now = job.at;
        if (job.interval) job.at += job.interval;
        else jobs.delete(key);
        job.fn(...job.args);
      }
      now = target;
    },
    emit(event) { for (const fn of [...listeners]) fn(event); },
    listenerCount: () => listeners.size,
    pending: () => jobs.size,
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      Object.defineProperty(Date, 'now', dateNow);
    },
  };
}

async function measure(sample, expectedSamples = 600) {
  const clock = fakeClock();
  try {
    let finished = false;
    const promise = runArmTest({ side: 'sag', durationMs: 10000 }).then(result => { finished = true; return result; });
    assert.equal(clock.listenerCount(), 1);
    // 600 events at [0, 10000) ms; finish timer fires exactly at 10000 ms.
    for (let frame = 0; frame < 600; frame++) {
      clock.advance(frame * 1000 / 60);
      clock.emit(sample(frame / 60, frame));
    }
    clock.advance(10000);
    await Promise.resolve();
    assert.equal(finished, true, 'must resolve at the virtual deadline');
    const result = await promise;
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'sensor');
    assert.equal(result.samples, expectedSamples);
    assert.equal(clock.listenerCount(), 0);
    assert.equal(clock.pending(), 0);
    return { ...result, risk: armRisk(result) };
  } finally { clock.restore(); }
}

function trial(kind, seed) {
  const random = rng(seed);
  const uniform = (a, b) => a + random() * (b - a);
  const beta = uniform(-40, 40), gamma = uniform(-15, 15);
  const frequency = uniform(8, 12), phase = uniform(0, 2 * Math.PI);
  const drop = kind === 'mild' ? uniform(4, 8) : kind === 'strong' ? uniform(10, 20) : uniform(0, 2);
  const rotation = kind === 'mild' ? uniform(3, 6) : kind === 'strong' ? uniform(8, 15) : 0;
  // Each channel: sinusoidal amplitude 0.6 deg + Gaussian white noise sigma
  // 0.6/sqrt(2), giving total noise sigma 0.6 deg. Drift spans all 10 s.
  const noise = t => 0.6 * Math.sin(2 * Math.PI * frequency * t + phase) + gaussian(random) * 0.6 / Math.SQRT2;
  return measure(t => {
    let b = beta + drop * t / 10;
    let g = gamma + rotation * t / 10;
    if (kind === 'settling') b = beta + (t < 1 ? 5 * (1 - t) : 0);
    if (kind === 'cough') b = beta + (t >= 4.75 && t < 5.25 ? 10 : 0);
    if (kind === 'wrap') b = 179 + 2 * t / 10;
    b += noise(t);
    g += noise(t + 0.013);
    return { beta: wrap(b), gamma: wrap(g) };
  });
}

test('arm sensor Monte Carlo: 200 seeded trials per scenario, 60 Hz, 10 s', async t => {
  const scenarios = [
    ['healthy', 'Saglikli / ozgulluk', 0.3, false, 0.95],
    // No requested sensitivity floor for mild cases: report detection rate
    // descriptively, while still checking all results are finite and in range.
    ['mild', 'Hafif / yakalama', 0.3, true, null],
    ['strong', 'Belirgin / duyarlilik', 0.5, true, 0.95],
    ['settling', 'Ilk 1 s yerlesme / ozgulluk', 0.3, false, 0.95],
    ['cough', '0.5 s oksuruk / ozgulluk', 0.3, false, 0.95],
    ['wrap', '179 -> -179 / ozgulluk', 0.3, false, 0.95],
  ];
  const results = [];
  for (const [index, [kind, name, threshold, positive, floor]] of scenarios.entries()) {
    const trials = [];
    for (let i = 0; i < N; i++) {
      const seed = (SEED + index * 10000 + i) >>> 0;
      const result = await trial(kind, seed);
      assert.ok(Number.isFinite(result.risk) && result.risk >= 0 && result.risk <= 1);
      trials.push({ seed, ...result });
    }
    const passes = trials.filter(r => positive ? r.risk >= threshold : r.risk < threshold).length;
    results.push({ name, floor, passes, rate: passes / N, trials, threshold, positive });
  }
  console.log(`Real runArmTest; seed=0x${SEED.toString(16)}; 200 x 600 sensor events/scenario`);
  console.table(results.map(r => ({ scenario: r.name, criterion: `risk ${r.positive ? '>=' : '<'} ${r.threshold}`, passed: `${r.passes}/${N}`, percent: (r.rate * 100).toFixed(1), minimum: r.floor === null ? 'descriptive' : `${r.floor * 100}%` })));
  for (const r of results) {
    await t.test(r.name, () => {
      if (r.floor === null) return assert.equal(r.trials.length, N);
      const failures = r.trials.filter(x => r.positive ? x.risk < r.threshold : x.risk >= r.threshold);
      assert.ok(r.rate >= r.floor, `${r.passes}/${N}; required ${r.floor * 100}%; first failures=${JSON.stringify(failures.slice(0, 3))}`);
    });
  }
});

test('circular median: balanced 179/-179 initial window is near 180, not zero', async () => {
  const result = await measure((t, frame) => ({
    // One missing sensor reading leaves 30 values on either side of the
    // boundary. All valid angles are within two degrees of each other.
    beta: t <= 1 ? (frame === 60 ? null : frame % 2 ? 179 : -179) : -179,
    gamma: 0,
  }), 599);
  assert.ok(result.risk < 0.3, `stationary circular cluster: ${JSON.stringify(result)}`);
});
