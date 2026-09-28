// =============================================================
// HIGH-FIDELITY AUTHENTIC 6-CYLINDER (V6 / INLINE-6) ENGINE & SKID AUDIO
// =============================================================

class EngineAudioSystem {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // 6-Cylinder Multi-Harmonic Sound Nodes
  private oscPrimaryFiring: OscillatorNode | null = null;     // 3 pulses per revolution (Fundamental)
  private oscHarmonicRasp: OscillatorNode | null = null;      // 6th order harmonic (Smooth 6-cyl metallic rasp)
  private oscInductionHowl: OscillatorNode | null = null;     // High-RPM intake roar
  private oscSubChassis: OscillatorNode | null = null;        // Deep mechanical chassis tone
  private oscTurboSpool: OscillatorNode | null = null;        // Subtle twin-turbo whistle

  // Filter bank
  private filterIntake: BiquadFilterNode | null = null;
  private filterExhaust: BiquadFilterNode | null = null;
  private filterTurbo: BiquadFilterNode | null = null;

  // Gain Stages
  private gainMain: GainNode | null = null;
  private gainHarmonic: GainNode | null = null;
  private gainInduction: GainNode | null = null;
  private gainSub: GainNode | null = null;
  private gainTurbo: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;

  // Handbrake Skid screech nodes ("صوت عوووو التفحيط")
  private skidNoiseNode: AudioBufferSourceNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;

  public init() {
    if (this.isInitialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // 1. Primary 6-Cylinder Ignition Oscillator (Sawtooth: 3 firings per crankshaft revolution)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(45, ctx.currentTime);

      // 2. Harmonic 6-Cylinder Metallic Tone (Sawtooth at 2x fundamental for velvety 6-cyl purr)
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(90.5, ctx.currentTime);

      // 3. Intake Induction Howl (Triangle / Soft Saw at 3x for throttle roar)
      const osc3 = ctx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(135, ctx.currentTime);

      // 4. Sub-bass chassis vibration (Sine wave at 0.5x fundamental)
      const osc4 = ctx.createOscillator();
      osc4.type = 'sine';
      osc4.frequency.setValueAtTime(22.5, ctx.currentTime);

      // 5. Subtle Twin-Turbo Spool Whistle (High sine wave)
      const oscTurbo = ctx.createOscillator();
      oscTurbo.type = 'sine';
      oscTurbo.frequency.setValueAtTime(1600, ctx.currentTime);

      // Soft Saturation Shaper for authentic internal combustion grit
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.make6CylDistortionCurve(16);
      shaper.oversample = '2x';
      this.distortionNode = shaper;

      // 6-Cylinder Resonant Intake Filter
      const filterIntake = ctx.createBiquadFilter();
      filterIntake.type = 'lowpass';
      filterIntake.Q.setValueAtTime(3.8, ctx.currentTime);
      filterIntake.frequency.setValueAtTime(420, ctx.currentTime);

      // Exhaust Tone Filter (Mid-range boost)
      const filterExhaust = ctx.createBiquadFilter();
      filterExhaust.type = 'peaking';
      filterExhaust.frequency.setValueAtTime(850, ctx.currentTime);
      filterExhaust.Q.setValueAtTime(2.2, ctx.currentTime);
      filterExhaust.gain.setValueAtTime(4.5, ctx.currentTime);

      // Turbo Spool Filter
      const filterTurbo = ctx.createBiquadFilter();
      filterTurbo.type = 'bandpass';
      filterTurbo.frequency.setValueAtTime(2200, ctx.currentTime);
      filterTurbo.Q.setValueAtTime(6.0, ctx.currentTime);

      // Master & Stage Gains
      const gainMain = ctx.createGain();
      gainMain.gain.setValueAtTime(0.048, ctx.currentTime);

      const gainHarm = ctx.createGain();
      gainHarm.gain.setValueAtTime(0.48, ctx.currentTime);

      const gainInduct = ctx.createGain();
      gainInduct.gain.setValueAtTime(0.35, ctx.currentTime);

      const gainSub = ctx.createGain();
      gainSub.gain.setValueAtTime(0.55, ctx.currentTime);

      const gainTurbo = ctx.createGain();
      gainTurbo.gain.setValueAtTime(0.002, ctx.currentTime);

      // Build Graph
      osc1.connect(shaper);
      shaper.connect(filterIntake);

      osc2.connect(gainHarm);
      gainHarm.connect(filterIntake);

      osc3.connect(gainInduct);
      gainInduct.connect(filterIntake);

      osc4.connect(gainSub);
      gainSub.connect(filterIntake);

      oscTurbo.connect(filterTurbo);
      filterTurbo.connect(gainTurbo);
      gainTurbo.connect(gainMain);

      filterIntake.connect(filterExhaust);
      filterExhaust.connect(gainMain);
      gainMain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc3.start();
      osc4.start();
      oscTurbo.start();

      this.oscPrimaryFiring = osc1;
      this.oscHarmonicRasp = osc2;
      this.oscInductionHowl = osc3;
      this.oscSubChassis = osc4;
      this.oscTurboSpool = oscTurbo;
      this.filterIntake = filterIntake;
      this.filterExhaust = filterExhaust;
      this.filterTurbo = filterTurbo;
      this.gainMain = gainMain;
      this.gainHarmonic = gainHarm;
      this.gainInduction = gainInduct;
      this.gainSub = gainSub;
      this.gainTurbo = gainTurbo;

      // Setup Handbrake Screech Synth ("صوت عوووو التفحيط")
      this.setupSkidSynthesizer(ctx);

      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext init error', e);
    }
  }

  private make6CylDistortionCurve(amount = 16) {
    const k = amount;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private setupSkidSynthesizer(ctx: AudioContext) {
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.setValueAtTime(1380, ctx.currentTime);
    skidFilter.Q.setValueAtTime(8.2, ctx.currentTime);

    const skidGain = ctx.createGain();
    skidGain.gain.setValueAtTime(0, ctx.currentTime);

    skidFilter.connect(skidGain);
    skidGain.connect(ctx.destination);

    this.skidFilter = skidFilter;
    this.skidGain = skidGain;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseSource.connect(skidFilter);
    noiseSource.start();
    this.skidNoiseNode = noiseSource;
  }

  // Update 6-Cylinder Audio Dynamics Frame by Frame
  public update(
    rpm: number,
    isAccelerating: boolean,
    isBraking: boolean,
    isShifting: boolean,
    isHandbraking: boolean,
    speedKmh: number
  ) {
    if (!this.ctx || !this.isInitialized || !this.oscPrimaryFiring || !this.gainMain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    try {
      // 6-Cylinder Fundamental Ignition Frequency:
      // (RPM / 60) * 3 firing cycles per rev (e.g. 900 RPM = 45Hz, 3000 RPM = 150Hz, 6800 RPM = 340Hz)
      const baseFreq = 35 + (rpm / 6800) * 165;
      this.oscPrimaryFiring.frequency.setTargetAtTime(baseFreq, now, 0.035);

      if (this.oscHarmonicRasp) {
        // 2nd Harmonic gives the signature metallic rasp of a 6-cylinder engine
        this.oscHarmonicRasp.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.035);
      }
      if (this.oscInductionHowl) {
        // 3rd Harmonic induction intake howl
        this.oscInductionHowl.frequency.setTargetAtTime(baseFreq * 3.02, now, 0.035);
      }
      if (this.oscSubChassis) {
        // Deep sub-harmonic
        this.oscSubChassis.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.035);
      }
      if (this.oscTurboSpool && this.gainTurbo) {
        // Turbocharger Spool Whistle on Acceleration
        const turboFreq = 1200 + (rpm / 6800) * 2800;
        this.oscTurboSpool.frequency.setTargetAtTime(turboFreq, now, 0.05);
        const turboVolume = isAccelerating ? (rpm / 6800) * 0.012 : 0.001;
        this.gainTurbo.gain.setTargetAtTime(turboVolume, now, 0.05);
      }

      if (this.filterIntake) {
        // Resonant throttle intake opening
        let targetCutoff = 380 + (rpm / 6800) * 1850;
        if (isAccelerating) targetCutoff += 1100;
        if (isShifting) targetCutoff = 280; // Smooth momentary gear shift drop
        this.filterIntake.frequency.setTargetAtTime(targetCutoff, now, 0.035);
      }

      let targetGain = 0.038 + (rpm / 6800) * 0.065;
      if (isAccelerating) targetGain += 0.042;
      if (isShifting) targetGain = 0.02;
      this.gainMain.gain.setTargetAtTime(targetGain, now, 0.035);

      // Handbrake tire screech ("صوت عوووو التفحيط")
      if (this.skidGain && this.skidFilter) {
        if (isHandbraking && speedKmh > 18) {
          const skidIntensity = Math.min(1.0, speedKmh / 75);
          this.skidGain.gain.setTargetAtTime(0.095 * skidIntensity, now, 0.035);
          this.skidFilter.frequency.setTargetAtTime(1320 + Math.sin(now * 28) * 300, now, 0.03);
        } else {
          this.skidGain.gain.setTargetAtTime(0.0001, now, 0.07);
        }
      }
    } catch {}
  }

  // Quick exhaust pop on 6-Cylinder gear shift
  public playShiftPop() {
    if (!this.ctx || !this.isInitialized) return;
    try {
      const now = this.ctx.currentTime;
      const popOsc = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();
      popOsc.type = 'triangle';
      popOsc.frequency.setValueAtTime(74, now);
      popOsc.frequency.exponentialRampToValueAtTime(30, now + 0.055);

      popGain.gain.setValueAtTime(0.065, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      popOsc.connect(popGain);
      popGain.connect(this.ctx.destination);
      popOsc.start(now);
      popOsc.stop(now + 0.065);
    } catch {}
  }

  // Quick horn chirp
  public playFlashChirp() {
    if (!this.ctx || !this.isInitialized) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.04);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch {}
  }
}

export const engineAudio = new EngineAudioSystem();
