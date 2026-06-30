// sound.js — tiny Web Audio synth for UI feedback. No asset files: every blip is
// generated from oscillators, so it's weightless and fully tunable. Two clearly
// distinct sounds: toggle ON = bright & ascending, toggle OFF = darker & descending.

let ctx = null;
function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One enveloped oscillator note. Tiny attack + smooth release → no clicks.
function note(c, { freq, start, dur, type = 'triangle', gain = 0.16, glideTo = null }) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

// ON — two ascending notes (C5 → G5): confident, bright.
export function playOn() {
  const c = audio(), t = c.currentTime;
  note(c, { freq: 523.25, start: t,         dur: 0.09, gain: 0.15 });
  note(c, { freq: 783.99, start: t + 0.065, dur: 0.14, gain: 0.17 });
}

// OFF — one darker note gliding down (G4 → B3): soft "power down".
export function playOff() {
  const c = audio(), t = c.currentTime;
  note(c, { freq: 392.0, start: t, dur: 0.17, gain: 0.14, glideTo: 246.94 });
}
