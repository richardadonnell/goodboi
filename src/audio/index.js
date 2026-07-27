/**
 * All of GoodBoi's sound, synthesized in WebAudio — no files, no loader.
 *
 *   const audio = createAudio({ events });
 *   audio.start();                 // from a user gesture (the start screen click)
 *   audio.update(dt, controller);  // footsteps are driven by the dog's speed
 *
 * Everything hangs off one master gain into a gentle compressor, so cues can
 * overlap without clipping. The bus subscriptions are set up immediately but no
 * AudioContext exists until `start()` — browsers require the gesture first.
 */

const MASTER = 0.42;

// Semitone -> Hz helper (A4 = 440).
const note = (semis, base = 440) => base * Math.pow(2, semis / 12);

export function createAudio({ events } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let ambient = null;
  let started = false;

  // Footstep pacing: one tick per this many metres of ground covered.
  const STEP_DISTANCE = 0.95;
  let stepAccum = 0;

  const now = () => ctx.currentTime;

  function makeNoiseBuffer() {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** One-shot noise source through a filter, with an exponential gain tail. */
  function noise({ type = 'bandpass', freq = 1000, q = 1, gain = 0.2, attack = 0.004, decay = 0.15, rate = 1 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = now();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
    return { filter, gain: g, at: t };
  }

  /** One-shot oscillator with an exponential tail. */
  function tone({ type = 'sine', freq = 440, gain = 0.15, attack = 0.01, decay = 0.4, delay = 0, glide = null }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t = now() + delay;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide.to, t + glide.time);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
    return osc;
  }

  // --- ambient bed ----------------------------------------------------------

  /**
   * Slow detuned pad: four low oscillators through a lowpass whose cutoff is
   * swept by an LFO. Quiet enough to sit under everything else.
   */
  function startAmbient() {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now());
    out.gain.exponentialRampToValueAtTime(0.09, now() + 6);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    filter.Q.value = 3.5;
    filter.connect(out).connect(master);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 230;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    // A minor-ish drone: root, fifth, octave, minor tenth.
    const voices = [
      [note(-24), 0],
      [note(-17), 4],
      [note(-12), -6],
      [note(-5), 7],
    ].map(([freq, detune]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      osc.connect(g).connect(filter);
      osc.start();
      return osc;
    });

    return { out, voices, lfo };
  }

  // --- cues -----------------------------------------------------------------

  /** A yip, not a growl: pitched body sliding down fast, with a breathy edge. */
  function bark() {
    if (!started) return;
    const t = now();
    // Body: "ruff" — quick rise then a drop, low-Q bandpass keeps it warm.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.035);
    osc.frequency.exponentialRampToValueAtTime(170, t + 0.19);

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(1100, t);
    formant.frequency.exponentialRampToValueAtTime(520, t + 0.2);
    formant.Q.value = 1.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    osc.connect(formant).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.3);

    // Breath transient on top so it reads as an animal, not a synth blip.
    noise({ freq: 1700, q: 0.8, gain: 0.09, attack: 0.005, decay: 0.09 });
  }

  function footstep() {
    if (!started) return;
    noise({
      type: 'lowpass',
      freq: 760 + Math.random() * 260,
      q: 0.7,
      gain: 0.045,
      attack: 0.002,
      decay: 0.05,
      rate: 0.85 + Math.random() * 0.4,
    });
  }

  function pickup() {
    if (!started) return;
    tone({ type: 'sine', freq: note(4, 880), gain: 0.13, attack: 0.006, decay: 0.35 });
    tone({ type: 'sine', freq: note(11, 880), gain: 0.09, attack: 0.006, decay: 0.5, delay: 0.07 });
    tone({ type: 'triangle', freq: note(16, 880), gain: 0.05, attack: 0.006, decay: 0.6, delay: 0.14 });
  }

  function carry() {
    if (!started) return;
    tone({ type: 'triangle', freq: note(-5, 440), gain: 0.08, attack: 0.008, decay: 0.18 });
  }

  /** Scrabbling paws: a handful of gritty noise bursts over ~0.4s. */
  function dig() {
    if (!started) return;
    for (let i = 0; i < 7; i++) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = 0.5 + Math.random() * 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500 + Math.random() * 1400;
      filter.Q.value = 1.4;
      const g = ctx.createGain();
      const t = now() + i * 0.055 + Math.random() * 0.02;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      src.connect(filter).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.1);
    }
  }

  /** Little rising arpeggio when the quest moves on. */
  function sting(base = 440) {
    if (!started) return;
    [0, 5, 7, 12].forEach((semis, i) => {
      tone({
        type: 'triangle',
        freq: note(semis, base),
        gain: 0.11,
        attack: 0.008,
        decay: 0.42,
        delay: i * 0.085,
      });
    });
  }

  /** Warm sustained chord under the credits; the ambient bed steps aside. */
  function endingChord() {
    if (!started) return;
    if (ambient) ambient.out.gain.exponentialRampToValueAtTime(0.0001, now() + 3);
    const t = now();
    [-24, -12, -5, 0, 4, 7].forEach((semis, i) => {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.value = note(semis, 330);
      osc.detune.value = (i % 2 ? 5 : -5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1 / (1 + i * 0.25), t + 1.6);
      g.gain.setValueAtTime(0.1 / (1 + i * 0.25), t + 6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 12);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 12.5);
    });
  }

  // --- bus wiring -----------------------------------------------------------

  events?.on('verb:bark', bark);
  events?.on('verb:dig', dig);
  events?.on('bone:collected', pickup);
  events?.on('item:carried', carry);
  events?.on('item:dropped', () => started && tone({ type: 'sine', freq: 180, gain: 0.06, decay: 0.14 }));
  events?.on('quest:beat', () => sting(440));
  events?.on('sidequest:done', () => sting(587.33));
  events?.on('memory:show', () => started && tone({ type: 'sine', freq: note(-12, 660), gain: 0.07, attack: 1.2, decay: 3 }));
  events?.on('game:ended', endingChord);

  // --- lifecycle ------------------------------------------------------------

  /** Must be called from a user gesture. Idempotent. */
  function start() {
    if (started) return;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(comp);

    noiseBuf = makeNoiseBuffer();
    started = true;
    ambient = startAmbient();
    ctx.resume?.();
  }

  const setSuspended = (on) => {
    if (!started) return;
    if (on) ctx.suspend();
    else ctx.resume();
  };

  /** Drives footsteps off the dog's actual ground speed. */
  function update(dt, { speed = 0, grounded = true } = {}) {
    if (!started || !grounded || speed < 0.6) {
      stepAccum = Math.min(stepAccum, STEP_DISTANCE);
      return;
    }
    stepAccum += speed * dt;
    while (stepAccum >= STEP_DISTANCE) {
      stepAccum -= STEP_DISTANCE;
      footstep();
    }
  }

  return {
    start,
    update,
    bark,
    pickup,
    dig,
    sting,
    pause: () => setSuspended(true),
    resume: () => setSuspended(false),
    setVolume: (v) => { if (started) master.gain.value = v; },
    get started() { return started; },
  };
}
