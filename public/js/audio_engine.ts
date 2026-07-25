// Version Tracker: public/js/audio_engine.ts (GAP-Flow v1.1.61)

window.gapFlowAudio = {
  playInfoSound(ctx: AudioContext | null): void {
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const playTone = (freq: number, duration: number, delay: number): void => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(1.00, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };

      playTone(523.25, 0.15, 0);
      playTone(659.25, 0.25, 0.12);
    } catch (e) {
      console.warn('[Audio] Beep blockiert:', e);
    }
  },

  playVictoryMelody(ctx: AudioContext | null): void {
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const playTone = (freq: number, duration: number, delay: number): void => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(1.00, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };

      playTone(554.37, 0.15, 0.00);
      playTone(493.88, 0.15, 0.15);
      playTone(554.37, 0.40, 0.30);
      playTone(369.99, 0.80, 0.70);

      playTone(587.33, 0.15, 1.90);
      playTone(554.37, 0.15, 2.05);
      playTone(587.33, 0.40, 2.20);
      playTone(493.88, 0.80, 2.60);

      playTone(659.25, 0.15, 3.80);
      playTone(587.33, 0.15, 3.95);
      playTone(659.25, 0.40, 4.10);
      playTone(554.37, 0.30, 4.50);
      playTone(493.88, 0.15, 4.80);
      playTone(554.37, 0.15, 4.95);
      playTone(587.33, 0.30, 5.10);
      playTone(554.37, 0.15, 5.40);
      playTone(493.88, 0.15, 5.55);

      playTone(369.99, 1.60, 5.70);
      playTone(440.00, 1.60, 5.70);
      playTone(554.37, 1.60, 5.70);
    } catch (e) {
      console.warn('[Audio] Siegermelodie blockiert:', e);
    }
  },

  unlockAudioContext(existingCtx: AudioContext | null): AudioContext | null {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;

      const ctx = existingCtx || new AudioContextClass();

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);

      return ctx;
    } catch (e) {
      console.warn('[Audio] AudioContext Freischaltung fehlgeschlagen:', e);
      return null;
    }
  },
};