import { settings } from '../store.js';

let ctx = null;

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.12, delay = 0, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.08, delay = 0, freq = 3000 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

const SOUNDS = {
  deal: () => {
    noise(0.07, { vol: 0.12, freq: 2500 });
    noise(0.07, { vol: 0.1, freq: 2800, delay: 0.09 });
  },
  chips: () => {
    for (let i = 0; i < 4; i++) tone(2400 + Math.random() * 900, 0.05, { type: 'triangle', vol: 0.05, delay: i * 0.045 });
  },
  good: () => {
    tone(660, 0.12, { type: 'triangle', vol: 0.1 });
    tone(990, 0.18, { type: 'triangle', vol: 0.1, delay: 0.1 });
  },
  bad: () => tone(220, 0.28, { type: 'sawtooth', vol: 0.06, slide: -90 }),
  tick: () => tone(1200, 0.03, { type: 'square', vol: 0.03 }),
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.09, delay: i * 0.1 })),
  shuffle: () => {
    for (let i = 0; i < 8; i++) noise(0.04, { vol: 0.07, freq: 2000 + i * 120, delay: i * 0.035 });
  },
};

export function sound(name) {
  if (!settings().sound) return;
  try {
    SOUNDS[name] && SOUNDS[name]();
  } catch {
    /* audio niedostępne */
  }
}

export function vibrate(pattern) {
  if (!settings().vibration || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* brak wsparcia */
  }
}

export function flash(kind) {
  const f = document.createElement('div');
  f.className = `flash ${kind}`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 600);
}

export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

const COLORS = ['#d9b45a', '#f3d78a', '#2fbf71', '#4cb3ff', '#ef5350', '#ffffff'];

export function confetti(n = 70) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = COLORS[i % COLORS.length];
    c.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    c.style.animationDelay = `${Math.random() * 0.3}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

export function feedback(correct, close) {
  if (correct) {
    sound('good');
    flash('good');
    vibrate(25);
  } else if (close) {
    sound('tick');
  } else {
    sound('bad');
    flash('bad');
    vibrate([60, 40, 60]);
  }
}
