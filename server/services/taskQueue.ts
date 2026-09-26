import { HttpError } from '../errors.js';

/** Bound expensive work and the number of requests held in memory. */
export class TaskQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly concurrency: number, private readonly maxWaiting = 8, private readonly waitMs = 45_000) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'The music server is busy. Please retry in a moment.');
      await new Promise<void>((resolve, reject) => {
        const start = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter(item => item !== start);
          reject(new HttpError(503, 'SERVICE_UNAVAILABLE', 'The music server is busy. Please retry in a moment.'));
        }, this.waitMs);
        timer.unref?.();
        this.waiting.push(start);
      });
    } else this.active += 1;
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
