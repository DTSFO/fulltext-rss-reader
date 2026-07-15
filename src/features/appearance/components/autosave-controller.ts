export type AutosaveQueueItem<Snapshot> = {
  generation: number;
  operationId: string;
  snapshot: Snapshot;
  retryCount: number;
};

type TimerHandle = ReturnType<typeof setTimeout> | number;

type LatestAutosaveQueueOptions<Snapshot, Result> = {
  debounceMs: number;
  createOperationId: () => string;
  submit: (item: AutosaveQueueItem<Snapshot>) => Promise<Result>;
  onStart?: (item: AutosaveQueueItem<Snapshot>) => void | Promise<void>;
  onResult: (
    item: AutosaveQueueItem<Snapshot>,
    result: Result,
    isLatest: boolean,
  ) => void | Promise<void>;
  onError: (
    item: AutosaveQueueItem<Snapshot>,
    error: unknown,
    isLatest: boolean,
  ) => void | Promise<void>;
  isUnknownOutcome?: (error: unknown) => boolean;
  unknownOutcomeRetries?: number;
  setTimer?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/**
 * A latest-dirty / in-flight / acknowledged serial autosave queue.
 *
 * Responses always update revision state through onResult, but only the latest
 * generation may be presented as saved. If a newer edit appears while an older
 * request is in flight, it remains independently debounced and is submitted
 * after the older acknowledgement settles.
 */
export class LatestAutosaveQueue<Snapshot, Result> {
  private readonly options: LatestAutosaveQueueOptions<Snapshot, Result>;
  private latest: AutosaveQueueItem<Snapshot> | null = null;
  private inFlight: AutosaveQueueItem<Snapshot> | null = null;
  private failedLatest: AutosaveQueueItem<Snapshot> | null = null;
  private acknowledgedGeneration = 0;
  private nextGeneration = 0;
  private ready = false;
  private timer: TimerHandle | null = null;
  private disposed = false;
  private settleWaiters: Array<(saved: boolean) => void> = [];

  constructor(options: LatestAutosaveQueueOptions<Snapshot, Result>) {
    this.options = options;
  }

  edit(snapshot: Snapshot): number {
    if (this.disposed) return this.nextGeneration;
    this.nextGeneration += 1;
    this.latest = {
      generation: this.nextGeneration,
      operationId: this.options.createOperationId(),
      snapshot,
      retryCount: 0,
    };
    this.failedLatest = null;
    this.ready = false;
    this.schedule();
    return this.nextGeneration;
  }

  isLatestGeneration(generation: number): boolean {
    return this.latest?.generation === generation;
  }

  flush(): void {
    if (this.disposed || !this.latest) return;
    this.cancelTimer();
    this.ready = true;
    void this.drain();
  }

  retryLatest(): void {
    if (this.disposed || !this.failedLatest || this.failedLatest.generation !== this.latest?.generation) return;
    // Preserve the operation ID because the previous network outcome may have
    // committed even though the browser did not receive its response.
    this.latest = { ...this.failedLatest };
    this.failedLatest = null;
    this.ready = true;
    void this.drain();
  }

  flushAndWait(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (!this.latest || this.latest.generation <= this.acknowledgedGeneration) return Promise.resolve(true);
    this.flush();
    return new Promise((resolve) => {
      this.settleWaiters.push(resolve);
      this.notifySettled();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.latest = null;
    this.failedLatest = null;
    for (const resolve of this.settleWaiters.splice(0)) resolve(false);
  }

  private schedule(): void {
    this.cancelTimer();
    const setTimer = this.options.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      this.timer = null;
      this.ready = true;
      void this.drain();
    }, this.options.debounceMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    const clearTimer = this.options.clearTimer ?? ((handle: TimerHandle) => globalThis.clearTimeout(handle));
    clearTimer(this.timer);
    this.timer = null;
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.inFlight || !this.ready || !this.latest) return;
    if (this.latest.generation <= this.acknowledgedGeneration) {
      this.ready = false;
      return;
    }

    const item = this.latest;
    this.ready = false;
    this.inFlight = item;

    try {
      await this.options.onStart?.(item);
      if (this.disposed) return;
      let result: Result;
      try {
        result = await this.options.submit(item);
      } catch (error) {
        const maximumRetries = this.options.unknownOutcomeRetries ?? 1;
        if (
          !this.disposed &&
          (this.options.isUnknownOutcome?.(error) ?? false) &&
          item.retryCount < maximumRetries
        ) {
          const retry = { ...item, retryCount: item.retryCount + 1 };
          // Retry the exact request identity before advancing revisions.
          this.inFlight = retry;
          result = await this.options.submit(retry);
        } else {
          throw error;
        }
      }

      this.acknowledgedGeneration = Math.max(this.acknowledgedGeneration, item.generation);
      if (this.failedLatest?.generation === item.generation) this.failedLatest = null;
      if (!this.disposed) {
        await this.options.onResult(item, result, this.isLatestGeneration(item.generation));
      }
    } catch (error) {
      if (!this.disposed) {
        const isLatest = this.isLatestGeneration(item.generation);
        if (isLatest) this.failedLatest = item;
        await this.options.onError(item, error, isLatest);
      }
    } finally {
      this.inFlight = null;
      if (this.disposed) return;
      if (this.latest && this.latest.generation > item.generation && this.timer === null) {
        // The newer edit's debounce elapsed while this request was in flight.
        this.ready = true;
      }
      if (this.ready) void this.drain();
      this.notifySettled();
    }
  }

  private notifySettled(): void {
    if (this.inFlight || this.ready || this.timer !== null) return;
    if (this.latest && this.latest.generation > this.acknowledgedGeneration && this.failedLatest?.generation !== this.latest.generation) {
      return;
    }
    const saved = !this.latest || this.latest.generation <= this.acknowledgedGeneration;
    for (const resolve of this.settleWaiters.splice(0)) resolve(saved);
  }
}
