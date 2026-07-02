import type { WebContents } from 'electron';

/**
 * Emettitore di progresso THROTTLED (§2, obbligatorio).
 * Coalizza gli aggiornamenti: max 1 evento IPC ogni THROTTLE_MS.
 * Su 50k tracce un evento-per-traccia congela la UI React: qui non può succedere.
 */
const THROTTLE_MS = 180;

export interface ProgressPayload {
  jobId: string;
  phase: string;
  done: number;
  total: number;
  message?: string;
}

export class ThrottledProgress {
  private lastSent = 0;
  private pending: ProgressPayload | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly webContents: WebContents,
    private readonly channel = 'job:progress'
  ) {}

  update(payload: ProgressPayload): void {
    const now = Date.now();
    if (now - this.lastSent >= THROTTLE_MS) {
      this.send(payload);
    } else {
      this.pending = payload;
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.pending) this.send(this.pending);
        }, THROTTLE_MS - (now - this.lastSent));
      }
    }
  }

  /** Evento finale: bypassa il throttle così il 100% arriva sempre. */
  finish(payload: ProgressPayload): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.send(payload);
  }

  private send(payload: ProgressPayload): void {
    this.pending = null;
    this.lastSent = Date.now();
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(this.channel, payload);
    }
  }
}
