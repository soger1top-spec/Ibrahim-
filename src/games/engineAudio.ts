// =============================================================
// HIGH-FIDELITY REALISTIC PETROL ENGINE & TIRE SKID SOUND ENGINE
// =============================================================

class EngineAudioSystem {
  private ctx: AudioContext | null = null;
  private oscPrimary: OscillatorNode | null = null;
  private oscHarmonic: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private filterIntake: BiquadFilterNode | null = null;
  private gainMain: GainNode | null = null;
  private gainHarmonic: GainNode | null = null;
  private gainSub: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;

  // Handbrake skid sound nodes ("صوت عوووو التفحيط")
  private skidNoiseNode: AudioBufferSourceNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;
  private isSkidding = false;

  private isInitialized = false;

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

      // 1. Primary Combustion Cylinder Firing Oscillator (Sawtooth)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(36, ctx.currentTime);

      // 2. Harmonic Petrol Rasp Oscillator (Pulse / Square)
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(72.5, ctx.currentTime);

      // 3. Deep Sub-Bass Exhaust Rumble (Triangle)
      const osc3 = ctx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(18, ctx.currentTime);

      // 4. Soft Saturation Curve for Rich Petrol Roar
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.makeDistortionCurve(18);
      shaper.oversample = '2x';
      this.distortionNode = shaper;

      // 5. Dynamic Resonant Intake / Exhaust Filter Bank
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(3.4, ctx.currentTime);
      filter.frequency.setValueAtTime(380, ctx.currentTime);

      // Gains
      const gainMain = ctx.createGain();
      gainMain.gain.setValueAtTime(0.045, ctx.currentTime);

      const gainHarm = ctx.createGain();
      gainHarm.gain.setValueAtTime(0.42, ctx.currentTime);

      const gainSub = ctx.createGain();
      gainSub.gain.setValueAtTime(0.65, ctx.currentTime);

      // Connect Engine Graph
      osc1.connect(shaper);
      shaper.connect(filter);

      osc2.connect(gainHarm);
      gainHarm.connect(filter);

      osc3.connect(gainSub);
      gainSub.connect(filter);

      filter.connect(gainMain);
      gainMain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc3.start();

      this.oscPrimary = osc1;
      this.oscHarmonic = osc2;
      this.oscSub = osc3;
      this.filterIntake = filter;
      this.gainMain = gainMain;
      this.gainHarmonic = gainHarm;
      this.gainSub = gainSub;

      // Setup Handbrake Screech Synth ("صوت عوووو التفحيط")
      this.setupSkidSynthesizer(ctx);

      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext init error', e);
    }
  }

  private makeDistortionCurve(amount = 20) {
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
    // Generate 2 seconds of pink/white noise buffer for looping skid screech
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.setValueAtTime(1400, ctx.currentTime);
    skidFilter.Q.setValueAtTime(7.5, ctx.currentTime);

    const skidGain = ctx.createGain();
    skidGain.gain.setValueAtTime(0, ctx.currentTime);

    skidFilter.connect(skidGain);
    skidGain.connect(ctx.destination);

    this.skidFilter = skidFilter;
    this.skidGain = skidGain;

    // We create and loop the noise source
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseSource.connect(skidFilter);
    noiseSource.start();
    this.skidNoiseNode = noiseSource;
  }

  // Update engine audio frame by frame
  public update(
    rpm: number,
    isAccelerating: boolean,
    isBraking: boolean,
    isShifting: boolean,
    isHandbraking: boolean,
    speedKmh: number
  ) {
    if (!this.ctx || !this.isInitialized || !this.oscPrimary || !this.gainMain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    try {
      // Real Combustion V8 Fundamental Frequency: (RPM / 60) * 4 firing pulses
      const baseFreq = 26 + (rpm / 6800) * 128;
      this.oscPrimary.frequency.setTargetAtTime(baseFreq, now, 0.035);

      if (this.oscHarmonic) {
        this.oscHarmonic.frequency.setTargetAtTime(baseFreq * 2.02, now, 0.035);
      }
      if (this.oscSub) {
        this.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.035);
      }

      if (this.filterIntake) {
        // High throttle resonance opens up throat for that unmistakable petrol roar "عن... عنننن"
        let targetCutoff = 360 + (rpm / 6800) * 1600;
        if (isAccelerating) targetCutoff += 950;
        if (isShifting) targetCutoff = 260; // Momentary shift burble
        this.filterIntake.frequency.setTargetAtTime(targetCutoff, now, 0.035);
      }

      let targetGain = 0.035 + (rpm / 6800) * 0.065;
      if (isAccelerating) targetGain += 0.04;
      if (isShifting) targetGain = 0.02;
      this.gainMain.gain.setTargetAtTime(targetGain, now, 0.035);

      // Handbrake tire screech ("صوت عوووو التفحيط")
      if (this.skidGain && this.skidFilter) {
        if (isHandbraking && speedKmh > 20) {
          const skidIntensity = Math.min(1.0, speedKmh / 80);
          this.skidGain.gain.setTargetAtTime(0.09 * skidIntensity, now, 0.04);
          this.skidFilter.frequency.setTargetAtTime(1250 + Math.sin(now * 25) * 280, now, 0.03);
          this.isSkidding = true;
        } else {
          this.skidGain.gain.setTargetAtTime(0.0001, now, 0.08);
          this.isSkidding = false;
        }
      }
    } catch {}
  }

  // Quick exhaust pop on gear shift
  public playShiftPop() {
    if (!this.ctx || !this.isInitialized) return;
    try {
      const now = this.ctx.currentTime;
      const popOsc = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();
      popOsc.type = 'triangle';
      popOsc.frequency.setValueAtTime(68, now);
      popOsc.frequency.exponentialRampToValueAtTime(25, now + 0.06);

      popGain.gain.setValueAtTime(0.06, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      popOsc.connect(popGain);
      popGain.connect(this.ctx.destination);
      popOsc.start(now);
      popOsc.stop(now + 0.07);
    } catch {}
  }

  // Quick horn / high beam flash sound
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
