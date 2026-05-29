/**
 * 1HP Procedural Web Audio API Sound Synthesizer
 * Generates all sound effects and driving synthwave background music programmatically
 * to ensure 100% local, dependency-free gameplay without downloading audio files.
 */

class CyberSynthEngine {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.musicEnabled = true;
    this.seqInterval = null;
    
    // Music variables
    this.bpm = 110;
    this.currentStep = 0;
    this.bassline = [
      55.00, 55.00, 55.00, 55.00, // A1
      65.41, 65.41, 65.41, 65.41, // C2
      48.99, 48.99, 48.99, 48.99, // G1
      73.42, 73.42, 73.42, 73.42  // D2
    ];
  }

  // Initialize the audio context (must be called after user interaction)
  init() {
    if (this.ctx) return;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("Web Audio API is not supported in this browser.");
      return;
    }
    
    this.ctx = new AudioContextClass();
    this.createNoiseBuffer();
    
    // Resume context if suspended (common browser security constraint)
    if (this.ctx.state === 'suspended') {
      const resume = () => {
        this.ctx.resume();
        window.removeEventListener('click', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('click', resume);
      window.addEventListener('keydown', resume);
    }
    
    // Autostart music loop
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
  }

  // Generate an internal white noise buffer for wooshes, dashes, and explosions
  createNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 1.5; // 1.5s of noise
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
  }

  // Sound FX: Sword Slash
  playSlash() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    
    // 1. Blade swing pitch sweep (Triangle wave for metal whistle)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.18);
    
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    // 2. Air friction noise burst
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.15);
    filter.Q.value = 3.0;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  // Sound FX: Cyber Dash Woosh
  playDash() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    // Bandpass filter swept upwards for that hyper-space release
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.14);
    filter.Q.value = 5.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(now);
    noise.stop(now + 0.16);
  }

  // Sound FX: High-skill metallic parry clink
  playParry() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    
    // Inharmonic bell ring using two high-frequency oscillators
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 500;

    const gain1 = this.ctx.createGain();
    const gain2 = this.ctx.createGain();
    const masterGain = this.ctx.createGain();

    // Steel ringing frequencies
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(950, now);
    osc1.frequency.exponentialRampToValueAtTime(900, now + 0.4);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1420, now);
    osc2.frequency.exponentialRampToValueAtTime(1400, now + 0.35);

    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    gain2.gain.setValueAtTime(0.12, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    masterGain.gain.setValueAtTime(0.8, now);
    masterGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    osc1.connect(gain1);
    osc2.connect(gain2);
    
    gain1.connect(filter);
    gain2.connect(filter);
    
    filter.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.5);
    osc2.start(now);
    osc2.stop(now + 0.5);
  }

  // Sound FX: Storm convergence alarm beep
  playWarningBeep() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.08); // double pulse high-chirp
    
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.25);
  }

  // Sound FX: Fatal Kill / Death Strike
  playHit() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;

    // 1. Heavy resonant sub-drop (explosive punch)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(120, now);
    subOsc.frequency.linearRampToValueAtTime(30, now + 0.4);

    subGain.gain.setValueAtTime(0.4, now);
    subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    const subFilter = this.ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(150, now);
    subFilter.frequency.exponentialRampToValueAtTime(50, now + 0.4);

    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(this.ctx.destination);

    // 2. White noise explosion crunch
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(800, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(100, now + 0.35);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    subOsc.start(now);
    subOsc.stop(now + 0.5);
    noise.start(now);
    noise.stop(now + 0.5);
  }

  // Sound FX: Portal Teleport Warp
  playTeleport() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(1600, now + 0.3);
    
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.31);
  }

  // Sound FX: Speed Pad Boost Woosh
  playSpeedBoost() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.linearRampToValueAtTime(1600, now + 0.25);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start(now);
    noise.stop(now + 0.26);
  }

  // Sound FX: Shield Collect Chime
  playShieldPickup() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    const gain2 = this.ctx.createGain();
    
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.08); // A5
    gain1.gain.setValueAtTime(0.1, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    osc2.frequency.setValueAtTime(783.99, now); // G5
    osc2.frequency.setValueAtTime(1174.66, now + 0.08); // D6
    gain2.gain.setValueAtTime(0.08, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.35);
    osc2.start(now);
    osc2.stop(now + 0.35);
  }

  // Sound FX: Shield Shatter / Pop
  playShieldPop() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.3);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.linearRampToValueAtTime(60, now + 0.25);
    
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.15, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    
    noise.start(now);
    noise.stop(now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // Sound FX: Cybernetic Chat Message Chirp
  playChat() {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    
    // Double pulse high-pitched mechanical chirp
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    const gain2 = this.ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1600, now);
    osc1.frequency.setValueAtTime(2000, now + 0.04);
    
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(2200, now + 0.04);
    osc2.frequency.setValueAtTime(2500, now + 0.08);
    
    gain2.gain.setValueAtTime(0.06, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.09);
    osc2.start(now + 0.04);
    osc2.stop(now + 0.13);
  }

  // --- Background Synthwave Loop Sequencer ---
  startMusicLoop() {
    if (this.seqInterval) return;

    const stepDuration = 60 / this.bpm / 2; // Eighth notes
    let nextNoteTime = this.ctx ? this.ctx.currentTime : 0;

    this.seqInterval = setInterval(() => {
      this.init();
      if (!this.ctx || this.ctx.state === 'suspended' || !this.musicEnabled) return;

      const lookAhead = 0.15; // Schedule 150ms ahead
      while (nextNoteTime < this.ctx.currentTime + lookAhead) {
        this.scheduleSeqStep(this.currentStep, nextNoteTime);
        nextNoteTime += stepDuration;
        this.currentStep = (this.currentStep + 1) % 16;
      }
    }, 50);
  }

  stopMusicLoop() {
    if (this.seqInterval) {
      clearInterval(this.seqInterval);
      this.seqInterval = null;
    }
  }

  scheduleSeqStep(step, time) {
    if (!this.musicEnabled) return;

    // 1. Kick Drum (Steps 0, 4, 8, 12)
    if (step === 0 || step === 4 || step === 8 || step === 12) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.12);
      
      gain.gain.setValueAtTime(0.18, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.15);
    }

    // 2. High Hat (Steps 2, 6, 10, 14 - off beats)
    if (step === 2 || step === 6 || step === 10 || step === 14) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7000, time);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.02, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      noise.start(time);
      noise.stop(time + 0.05);
    }

    // 3. Cyber Bass Arpeggiator (Every eighth note)
    const baseFreq = this.bassline[step];
    // Slightly filter the bass so it sounds fat and driving
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    const bassFilter = this.ctx.createBiquadFilter();
    
    // Sawtooth arpeggio for classic synthwave feel
    bassOsc.type = 'sawtooth';
    // Sub-bass frequency
    bassOsc.frequency.setValueAtTime(baseFreq, time);
    
    // Open filter envelope on every note
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(200, time);
    bassFilter.frequency.exponentialRampToValueAtTime(80, time + 0.12);
    bassFilter.Q.value = 1.0;

    // Short snappy envelope decay
    bassGain.gain.setValueAtTime(0.07, time);
    bassGain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.ctx.destination);
    
    bassOsc.start(time);
    bassOsc.stop(time + 0.13);
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    const btn = document.getElementById('music-toggle-btn');
    if (btn) {
      btn.querySelector('.btn-text').innerText = this.musicEnabled ? "MUSIC: ON" : "MUSIC: OFF";
    }

    if (this.musicEnabled) {
      this.init();
      this.startMusicLoop();
    } else {
      this.stopMusicLoop();
    }
  }
}

// Instanced global synthesizer
const CyberSynth = new CyberSynthEngine();

// Auto-trigger audio context on toggle click
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('music-toggle-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      CyberSynth.toggleMusic();
    });
  }
});
