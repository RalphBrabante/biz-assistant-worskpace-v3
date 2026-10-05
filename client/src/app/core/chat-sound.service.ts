import { Injectable, OnDestroy } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatSoundService implements OnDestroy {
  enabled = true;
  private context: AudioContext | null = null;
  private interacted = false;
  private lastPlayedAt = -Infinity;
  private readonly onInteraction = () => {
    this.interacted = true;
    if (this.enabled) this.ensureContext();
    window.removeEventListener('pointerdown', this.onInteraction);
    window.removeEventListener('keydown', this.onInteraction);
  };

  constructor() {
    try { this.enabled = localStorage.getItem('teamChatSound') !== 'off'; } catch { /* Storage may be disabled. */ }
    // Browsers allow audio after a click or key press within the application.
    window.addEventListener('pointerdown', this.onInteraction);
    window.addEventListener('keydown', this.onInteraction);
  }
  toggle(): void {
    this.enabled = !this.enabled;
    try { localStorage.setItem('teamChatSound', this.enabled ? 'on' : 'off'); } catch { /* Keep the preference for this session. */ }
    if (this.enabled) { this.interacted = true; this.ensureContext(); }
  }
  private ensureContext(): AudioContext | null {
    try {
      const Constructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return null;
      this.context ||= new Constructor();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
      return this.context;
    } catch { return null; }
  }
  play(): void {
    if (!this.enabled || !this.interacted || Date.now() - this.lastPlayedAt < 800) return;
    const context = this.ensureContext();
    if (!context) return;
    this.lastPlayedAt = Date.now();
    const tones = () => {
      try {
        for (const [frequency, delay] of [[660, 0], [880, 0.13]]) {
          const start = context.currentTime + delay;
          const gain = context.createGain(), tone = context.createOscillator();
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
          gain.connect(context.destination);
          tone.type = 'sine'; tone.frequency.setValueAtTime(frequency, start);
          tone.connect(gain); tone.onended = () => { tone.disconnect(); gain.disconnect(); };
          tone.start(start); tone.stop(start + 0.2);
        }
      } catch { /* Audio failures must not interrupt chat. */ }
    };
    if (context.state === 'suspended') void context.resume().then(tones).catch(() => undefined);
    else tones();
  }
  ngOnDestroy(): void {
    window.removeEventListener('pointerdown', this.onInteraction);
    window.removeEventListener('keydown', this.onInteraction);
    if (this.context) void this.context.close().catch(() => undefined);
  }
}
