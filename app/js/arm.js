const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const angle = (n) => ((n + 180) % 360 + 360) % 360 - 180;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2 : 0;
};

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

export async function requestPermission() {
  try {
    if (typeof window === 'undefined') return false;
    // İki izin isteğini de kullanıcı etkileşimi sürerken başlat.
    const permissions = [window.DeviceOrientationEvent, window.DeviceMotionEvent].map((api) =>
      typeof api?.requestPermission === 'function' ? api.requestPermission() : 'granted');
    return (await Promise.all(permissions)).every((permission) => permission === 'granted');
  } catch {
    return false;
  }
}

// Açıları ilk örneğe göre "açar": 179° ile -179° arası 2° fark olarak kalsın, 358° değil.
function unwrap(values) {
  if (!values.length) return values;
  const ref = values[0];
  return values.map((v) => ref + angle(v - ref));
}

function calculate(rawSamples, side, durationMs, mode) {
  const betas = unwrap(rawSamples.map((x) => x.beta));
  const gammas = unwrap(rawSamples.map((x) => x.gamma));
  const samples = rawSamples.map((x, i) => ({ ...x, beta: betas[i], gamma: gammas[i] }));
  const start = samples.filter((sample) => sample.time <= 1000);
  const end = samples.filter((sample) => sample.time >= durationMs - 2000);
  const beta0 = median(start.map((sample) => sample.beta));
  const gamma0 = median(start.map((sample) => sample.gamma));
  const settled = samples.filter((sample) => sample.time > 1000);
  const deviations = [];
  for (let i = 4; i < settled.length; i++) {
    const average = settled.slice(i - 4, i + 1).reduce((sum, sample) => sum + sample.beta, 0) / 5;
    deviations.push(settled[i].beta - average);
  }
  const mean = deviations.reduce((sum, n) => sum + n, 0) / (deviations.length || 1);
  const result = {
    side,
    driftDeg: Math.abs(angle(median(end.map((sample) => sample.beta)) - beta0)),
    rotationDeg: Math.abs(angle(median(end.map((sample) => sample.gamma)) - gamma0)),
    tremorDeg: Math.sqrt(deviations.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (deviations.length || 1)),
    samples: samples.length,
    durationMs,
    mode,
    // Başta ve sonda yeterli veri olmalı, son örnek sürenin sonuna yakın olmalı (yarım ölçüm başarılı sayılmasın).
    ok: samples.length >= 20 && start.length >= 5 && end.length >= 5
      && samples[samples.length - 1].time >= durationMs - 600,
  };
  if (!result.ok) result.reason = 'Sensör verisi gelmedi';
  return result;
}

export function runArmTest({ side, durationMs = 10000, demo = false, demoProfile = 'normal', onTick, signal }) {
  return new Promise((resolve, reject) => {
    const samples = [];
    const started = performance.now();
    let tickTimer, sampleTimer, finishTimer;
    let done = false;
    const elapsed = () => Math.min(durationMs, performance.now() - started);
    const receive = (event) => {
      if (Number.isFinite(event.beta) && Number.isFinite(event.gamma)) {
        samples.push({ time: elapsed(), beta: event.beta, gamma: event.gamma });
      }
    };
    const cleanup = () => {
      clearInterval(tickTimer);
      clearInterval(sampleTimer);
      clearTimeout(finishTimer);
      if (!demo && typeof window !== 'undefined') window.removeEventListener('deviceorientation', receive);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('İptal', 'AbortError'));
    const tick = () => {
      const now = elapsed();
      const beta0 = median(samples.filter((sample) => sample.time <= 1000).map((sample) => sample.beta));
      const recent = samples.filter((sample) => sample.time >= now - 500);
      onTick?.(clamp(now / durationMs, 0, 1), recent.length ? Math.abs(angle(median(recent.map((sample) => sample.beta)) - beta0)) : 0);
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (demo) {
        sampleTimer = setInterval(() => {
          const time = elapsed();
          // Son iki saniyenin medyanında istenen yaklaşık açıya ulaş.
          const progress = clamp((time - 1000) / Math.max(1, durationMs - 2000), 0, 1);
          const falling = demoProfile === 'dusme';
          receive({ beta: progress * (falling ? 14 : 1.5) + (Math.random() - 0.5) * 0.3,
            gamma: progress * (falling ? 11 : 2) + (Math.random() - 0.5) * 0.3 });
        }, 1000 / 30);
      } else if (typeof window !== 'undefined') {
        window.addEventListener('deviceorientation', receive);
      }
      tickTimer = setInterval(() => { try { tick(); } catch (error) { fail(error); } }, 100);
      finishTimer = setTimeout(() => {
        if (done) return;
        try {
          tick();
          if (done) return;
          const result = calculate(samples, side, durationMs, demo ? 'demo' : 'sensor');
          done = true;
          cleanup();
          resolve(result);
        } catch (error) { fail(error); }
      }, durationMs);
    } catch (error) { fail(error); }
  });
}

export function armRisk(result, baseline) {
  if (!result.ok) return null;
  const d = baseline ? Math.max(0, result.driftDeg - baseline.driftDeg) : result.driftDeg;
  const r = baseline ? Math.max(0, result.rotationDeg - baseline.rotationDeg) : result.rotationDeg;
  // Kalibrasyon (21 Kas, sentetik testler): 3° altı sağlıklı titreme/kayma sayılır, 10°'de tam risk.
  // Düşme ile içe dönme birlikte olunca (klasik pronator drift) risk artar.
  const dr = clamp((d - 3) / 7, 0, 1);
  const rr = clamp((r - 3) / 7, 0, 1);
  return clamp(Math.max(dr, rr) * 0.7 + Math.min(dr, rr) * 0.3, 0, 1);
}
