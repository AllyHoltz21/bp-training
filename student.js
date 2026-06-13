(() => {
  // -------- Read instructor setup --------
  const systolic = parseInt(sessionStorage.getItem('bp_systolic') || '120', 10);
  const diastolic = parseInt(sessionStorage.getItem('bp_diastolic') || '80', 10);
  const heartRate = parseInt(sessionStorage.getItem('bp_hr') || '72', 10);

  if (!sessionStorage.getItem('bp_systolic')) {
    // No instructor setup — send back.
    if (confirm('No blood pressure has been set. Return to the instructor page?')) {
      window.location.href = 'index.html';
      return;
    }
  }

  // -------- State --------
  let pressure = 0;            // current cuff pressure (mmHg)
  const MAX_PRESSURE = 300;
  const PUMP_PER_CLICK = 15;   // mmHg gained per pump
  const DEFLATE_RATE = 2.5;    // mmHg per second when valve open
  const LEAK_RATE = 0.05;      // mmHg per second baseline leak

  let valveOpen = false;
  let lastFrameTime = performance.now();
  let lastBeatTime = 0;        // ms timestamp of last heartbeat
  let displayedAngle = -135;   // current needle angle (lerps toward target)
  const beatInterval = () => 60000 / heartRate;

  // -------- Elements --------
  const needleGroup = document.getElementById('needle-group');
  const pressureValue = document.getElementById('pressure-value');
  const cuff = document.getElementById('cuff');
  const pumpBtn = document.getElementById('pump-btn');
  const valveBtn = document.getElementById('valve-btn');
  const resetBtn = document.getElementById('reset-btn');
  const answerForm = document.getElementById('answer-form');
  const feedbackEl = document.getElementById('feedback');

  // -------- Draw gauge ticks --------
  const tickG = document.getElementById('tick-marks');
  const labelG = document.getElementById('tick-labels');
  const CENTER = 150;
  const OUTER_R = 134;
  const TICK_MAJOR_LEN = 14;
  const TICK_MINOR_LEN = 7;
  const LABEL_R = 110;
  const START_ANGLE_DEG = -135; // 0 mmHg
  const SWEEP_DEG = 270;        // 0 → 300

  function pressureToAngle(p) {
    return START_ANGLE_DEG + (p / MAX_PRESSURE) * SWEEP_DEG;
  }

  function polar(cx, cy, r, angleDeg) {
    // 0° points "up" in our convention (matches initial needle pointing up before rotation)
    const a = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  for (let p = 0; p <= MAX_PRESSURE; p += 2) {
    const isMajor = p % 10 === 0;
    const angle = pressureToAngle(p);
    const outer = polar(CENTER, CENTER, OUTER_R, angle);
    const inner = polar(
      CENTER,
      CENTER,
      OUTER_R - (isMajor ? TICK_MAJOR_LEN : TICK_MINOR_LEN),
      angle
    );

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', outer.x);
    line.setAttribute('y1', outer.y);
    line.setAttribute('x2', inner.x);
    line.setAttribute('y2', inner.y);
    line.setAttribute('class', 'tick' + (isMajor ? ' major' : ''));
    tickG.appendChild(line);

    if (p % 20 === 0) {
      const lp = polar(CENTER, CENTER, LABEL_R, angle);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', lp.x);
      text.setAttribute('y', lp.y);
      text.setAttribute('class', 'tick-label');
      text.textContent = p;
      labelG.appendChild(text);
    }
  }

  // -------- Audio: Web Audio API for Korotkoff sounds --------
  let audioCtx = null;
  let masterGain = null;

  function ensureAudio() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    // Limiter so the louder taps stay punchy without harsh digital clipping.
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    masterGain.connect(limiter);
    limiter.connect(audioCtx.destination);
  }

  // Build a buffer of low-frequency noise to use for "thump" texture.
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = audioCtx.sampleRate * 0.3;
    noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Brown noise — low-frequency-rich, good for body sounds
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 4;
    }
    return noiseBuffer;
  }

  // Play one Korotkoff "tap" tuned to its position in the systolic→diastolic range.
  // intensity 0..1 (1 = peak Phase III)
  function playKorotkoff(intensity, phase) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;

    // ---- Noise component: filtered low-frequency thump ----
    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    // Phase I-III: sharper "tap" (higher center). Phase IV: muffled (lower center).
    if (phase === 'muffled') {
      noiseFilter.frequency.value = 55;
      noiseFilter.Q.value = 2.5;
    } else {
      noiseFilter.frequency.value = 90;
      noiseFilter.Q.value = 3.5;
    }

    const noiseGain = audioCtx.createGain();
    const peak = 0.95 * intensity;
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(peak, t + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(
      0.0005,
      t + (phase === 'muffled' ? 0.18 : 0.11)
    );

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(t);
    noise.stop(t + 0.3);

    // ---- Low oscillator "thump" body ----
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    const startFreq = phase === 'muffled' ? 70 : 95;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);

    const oscGain = audioCtx.createGain();
    const oscPeak = 0.6 * intensity;
    oscGain.gain.setValueAtTime(0, t);
    oscGain.gain.linearRampToValueAtTime(oscPeak, t + 0.008);
    oscGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Background "stethoscope noise" — quiet hiss so the silence isn't dead.
  let bgNoiseNode = null;
  function startBackgroundHiss() {
    if (!audioCtx || bgNoiseNode) return;
    const bufferSize = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.04;

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    const g = audioCtx.createGain();
    g.gain.value = 0.06;

    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start();
    bgNoiseNode = src;
  }

  // -------- Korotkoff phase logic --------
  // Given current pressure relative to systolic/diastolic, decide:
  //   - whether a sound plays at all
  //   - its loudness (intensity)
  //   - its character ('tap' vs 'muffled')
  function korotkoffFor(p) {
    if (p >= systolic + 1 || p <= diastolic - 1) {
      return null; // silent
    }
    const range = systolic - diastolic;
    // pos = 1 at systolic, 0 at diastolic
    const pos = (p - diastolic) / range;

    // Phase I (just below systolic): clear tap, moderate volume
    // Phase II-III (middle): loudest, sharp
    // Phase IV (just above diastolic): muffled, softer
    // Phase V: silent (handled above)
    let intensity;
    let phase = 'tap';
    if (pos > 0.85) {
      intensity = 0.55 + (1 - pos) * 1.5; // ramps up as we descend
    } else if (pos > 0.35) {
      intensity = 0.95;
    } else if (pos > 0.1) {
      intensity = 0.65;
      phase = 'muffled';
    } else {
      intensity = 0.35;
      phase = 'muffled';
    }
    return { intensity: Math.min(1, intensity), phase };
  }

  // -------- Render loop --------
  function setPressure(p) {
    pressure = Math.max(0, Math.min(MAX_PRESSURE, p));
    pressureValue.textContent = Math.round(pressure);
    cuff.classList.toggle('inflated', pressure > 20);
  }

  function tick(now) {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Pressure dynamics
    if (pressure > 0) {
      let drop = LEAK_RATE * dt;
      if (valveOpen) drop += DEFLATE_RATE * dt;
      setPressure(pressure - drop);
    }

    // Smooth needle: lerp displayed angle toward the target each frame.
    const targetAngle = pressureToAngle(pressure);
    displayedAngle += (targetAngle - displayedAngle) * Math.min(1, dt * 8);
    needleGroup.setAttribute(
      'transform',
      `rotate(${displayedAngle.toFixed(3)} 150 150)`
    );

    // Heartbeat → trigger Korotkoff if in range
    if (audioCtx && now - lastBeatTime >= beatInterval()) {
      lastBeatTime = now;
      const k = korotkoffFor(pressure);
      if (k) playKorotkoff(k.intensity, k.phase);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame((t) => {
    lastFrameTime = t;
    lastBeatTime = t;
    tick(t);
  });

  // -------- Controls --------
  pumpBtn.addEventListener('click', () => {
    ensureAudio();
    startBackgroundHiss();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // Small random variation per pump so it feels real
    const delta = PUMP_PER_CLICK + (Math.random() * 6 - 3);
    setPressure(pressure + delta);
  });

  valveBtn.addEventListener('click', () => {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    valveOpen = !valveOpen;
    valveBtn.setAttribute('aria-pressed', String(valveOpen));
    valveBtn.querySelector('.btn-title').textContent = valveOpen
      ? 'Close Valve'
      : 'Open Valve';
    valveBtn.querySelector('.btn-sub').textContent = valveOpen
      ? 'Deflating slowly…'
      : 'Click to deflate slowly';
  });

  resetBtn.addEventListener('click', () => {
    setPressure(0);
    valveOpen = false;
    valveBtn.setAttribute('aria-pressed', 'false');
    valveBtn.querySelector('.btn-title').textContent = 'Open Valve';
    valveBtn.querySelector('.btn-sub').textContent = 'Click to deflate slowly';
  });

  // -------- Answer submission --------
  answerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const ansSys = parseInt(document.getElementById('ans-systolic').value, 10);
    const ansDia = parseInt(document.getElementById('ans-diastolic').value, 10);

    if (Number.isNaN(ansSys) || Number.isNaN(ansDia)) return;

    const sysErr = Math.abs(ansSys - systolic);
    const diaErr = Math.abs(ansDia - diastolic);
    const maxErr = Math.max(sysErr, diaErr);

    feedbackEl.hidden = false;
    feedbackEl.classList.remove('correct', 'close', 'wrong');

    if (maxErr === 0) {
      feedbackEl.classList.add('correct');
      feedbackEl.innerHTML = `
        <strong>Perfect.</strong> Exact reading: ${systolic}/${diastolic} mmHg.
      `;
    } else if (maxErr <= 4) {
      feedbackEl.classList.add('correct');
      feedbackEl.innerHTML = `
        <strong>Excellent.</strong> You read ${ansSys}/${ansDia}; actual was
        ${systolic}/${diastolic} mmHg. Within clinical tolerance.
      `;
    } else if (maxErr <= 10) {
      feedbackEl.classList.add('close');
      feedbackEl.innerHTML = `
        <strong>Close.</strong> You read ${ansSys}/${ansDia}; actual was
        ${systolic}/${diastolic} mmHg.
        ${sysErr > 4 ? `Systolic off by ${sysErr} mmHg. ` : ''}
        ${diaErr > 4 ? `Diastolic off by ${diaErr} mmHg. ` : ''}
        Try deflating more slowly next time.
      `;
    } else {
      feedbackEl.classList.add('wrong');
      feedbackEl.innerHTML = `
        <strong>Off the mark.</strong> You read ${ansSys}/${ansDia}; actual was
        ${systolic}/${diastolic} mmHg.
        Re-inflate above ${systolic + 30} mmHg and listen carefully as you
        release. Systolic = first Korotkoff sound; diastolic = where they
        disappear.
      `;
    }
  });

  // -------- Init --------
  setPressure(0);
})();
