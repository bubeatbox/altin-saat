export const CUMLELER = ['Bugün hava çok güzel, dışarı çıkalım.', 'Annem pazardan taze ekmek aldı.', 'Kırmızı kalemi masanın üstüne bırak.'];

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const words = (text) => normalizeTr(text).split(' ').filter(Boolean);
const recognitionReason = 'Konuşma tanıma bu tarayıcıda yok; yalnız ses ölçüldü';

export function normalizeTr(s) {
  return String(s).toLocaleLowerCase('tr-TR').replace(/\p{P}/gu, '').replace(/\s+/gu, ' ').trim();
}

export function wordAccuracy(target, transcript) {
  const expected = words(target);
  const actual = words(transcript);
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const current = [i];
    for (let j = 1; j <= actual.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return clamp(1 - previous[actual.length] / Math.max(expected.length, 1), 0, 1);
}

export function isSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function runSpeechTest({ target, maxMs = 9000, demo = false, demoProfile = 'normal', onLevel, onPartial, signal }) {
  return new Promise((resolve, reject) => {
    let stream, context, source, recognition, levelTimer, deadline;
    let done = false;
    let transcript = '';
    let recognitionAvailable = false;
    let firstSound = null, lastSound = null, silenceStart = null;
    let pauseMs = 0;
    const cleanup = () => {
      clearInterval(levelTimer);
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (recognition) {
        recognition.onresult = recognition.onerror = recognition.onend = null;
        try { recognition.abort(); } catch { /* Tanıma zaten durmuş olabilir. */ }
      }
      stream?.getTracks().forEach((track) => track.stop());
      try { source?.disconnect(); } catch { /* Kaynak zaten ayrılmış olabilir. */ }
      if (context && context.state !== 'closed') {
        try { void context.close().catch(() => {}); } catch { /* Bağlam zaten kapanmış olabilir. */ }
      }
    };
    const fail = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('İptal', 'AbortError'));
    const finish = (overrides = {}) => {
      if (done) return;
      done = true;
      cleanup();
      const durationMs = firstSound === null ? 0 : Math.max(0, lastSound - firstSound);
      const result = {
        target, transcript,
        accuracy: recognitionAvailable ? wordAccuracy(target, transcript) : null,
        wordsPerSec: durationMs > 0 ? (transcript ? words(transcript).length : recognitionAvailable ? 0 : words(target).length) / (durationMs / 1000) : 0,
        pauseRatio: durationMs > 0 ? clamp(pauseMs / durationMs, 0, 1) : 0,
        durationMs, mode: demo ? 'demo' : 'speech', ok: firstSound !== null,
      };
      if (firstSound === null) result.reason = 'Ses algılanmadı';
      else if (!recognitionAvailable) result.reason = recognitionReason;
      resolve({ ...result, ...overrides });
    };
    // Normal bitiş: tanıma çalışıyorsa stop() ile son metni iste, en çok 1500 ms bekle.
    let wrapping = false;
    const wrapUp = () => {
      if (done || wrapping) return;
      if (!recognition || !recognitionAvailable) { finish(); return; }
      wrapping = true;
      recognition.onend = () => finish();
      try { recognition.stop(); } catch { finish(); return; }
      setTimeout(() => finish(), 1500);
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });

    if (demo) {
      const broken = demoProfile === 'bozuk';
      const targetWords = words(target);
      const demoWords = broken ? targetWords.filter((_, i) => i % 3 !== 2) : targetWords;
      if (broken && demoWords.length) demoWords[demoWords.length - 1] = demoWords[demoWords.length - 1].slice(0, -1) + 'm';
      const finalText = broken ? demoWords.join(' ') : target;
      const demoDuration = Math.min(4000, maxMs);
      const started = performance.now();
      let shown = 0;
      recognitionAvailable = true;
      firstSound = 0;
      lastSound = demoDuration;
      levelTimer = setInterval(() => {
        try {
          const progress = clamp((performance.now() - started) / demoDuration, 0, 1);
          const silent = Math.sin(progress * Math.PI * 12) > (broken ? 0.45 : 0.97);
          onLevel?.(silent ? 0.01 : 0.25 + Math.random() * 0.4);
          if (done) return;
          const count = Math.min(demoWords.length, Math.floor(progress * (demoWords.length + 1)));
          if (count > shown) { shown = count; onPartial?.(demoWords.slice(0, count).join(' ')); }
        } catch (error) { fail(error); }
      }, 50);
      deadline = setTimeout(() => {
        try {
          transcript = finalText;
          onPartial?.(finalText);
          finish({ wordsPerSec: broken ? 1.1 : 2.4, pauseRatio: broken ? 0.35 : 0.08 });
        } catch (error) { fail(error); }
      }, demoDuration);
      return;
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        finish({ ok: false, reason: 'Mikrofon izni verilmedi' });
        return;
      }
      // İzin penceresi açıkken iptal edilmişse sonradan gelen izleri de kapat.
      if (done) { stream.getTracks().forEach((track) => track.stop()); return; }
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        context = new AudioContextClass();
        source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        deadline = setTimeout(() => wrapUp(), maxMs);
        await context.resume();
        if (done) return;
        const data = new Float32Array(analyser.fftSize);
        const started = performance.now();
        const noise = [];
        let threshold = 0.02;
        levelTimer = setInterval(() => {
          try {
            const now = performance.now() - started;
            analyser.getFloatTimeDomainData(data);
            const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
            onLevel?.(clamp(rms * 5, 0, 1));
            if (done) return;
            if (now < 300) { noise.push(rms); return; }
            threshold = Math.max(0.02, noise.reduce((sum, value) => sum + value, 0) / (noise.length || 1) * 2.5);
            if (rms > threshold) {
              if (firstSound === null) firstSound = now;
              if (silenceStart !== null && now - silenceStart > 250) pauseMs += now - silenceStart;
              lastSound = now;
              silenceStart = null;
            } else if (firstSound !== null) {
              if (silenceStart === null) silenceStart = now;
              if (now - lastSound >= 1500) wrapUp();
            }
          } catch (error) { fail(error); }
        }, 50);
        if (isSupported()) {
          try {
            const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognition = new Recognition();
            recognition.lang = 'tr-TR';
            recognition.interimResults = true;
            recognition.continuous = false;
            recognitionAvailable = true;
            recognition.onresult = (event) => {
              if (done || !recognitionAvailable) return;
              try {
                const parts = [];
                let final = false;
                for (let i = 0; i < event.results.length; i++) {
                  parts.push(event.results[i][0].transcript);
                  if (event.results[i].isFinal) final = true;
                }
                transcript = parts.join(' ').trim();
                onPartial?.(transcript);
                if (final) finish();
              } catch (error) { fail(error); }
            };
            recognition.onerror = () => {
              // Ara metin geldiyse onu kullan; hiç metin yoksa yalnız ses ölçümüne düş.
              if (!transcript) recognitionAvailable = false;
            };
            recognition.start();
          } catch {
            recognitionAvailable = false;
            transcript = '';
          }
        }
      } catch (error) { fail(error); }
    };
    void start();
  });
}

export function speechRisk(result, baseline) {
  if (!result.ok) return null;
  const { accuracy, wordsPerSec, pauseRatio } = result;
  const acc = clamp((0.9 - accuracy) / 0.4, 0, 1);
  const rate = baseline
    ? (baseline.wordsPerSec > 0 ? clamp((baseline.wordsPerSec - wordsPerSec) / (baseline.wordsPerSec * 0.5), 0, 1) : 0)
    : clamp((2.0 - wordsPerSec) / 1.0, 0, 1);
  const pause = baseline ? clamp((pauseRatio - baseline.pauseRatio) / 0.25, 0, 1) : clamp((pauseRatio - 0.15) / 0.25, 0, 1);
  return accuracy === null ? rate * 0.5 + pause * 0.5 : acc * 0.5 + rate * 0.25 + pause * 0.25;
}
