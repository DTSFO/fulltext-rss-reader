import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LatestAutosaveQueue,
  type AutosaveQueueItem,
} from "@/features/appearance/components/autosave-controller";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LatestAutosaveQueue", () => {
  it.each(["formal", "draft"] as const)(
    "submits B with the revision acknowledged by an in-flight A %s response",
    async (outcome) => {
      vi.useFakeTimers();
      const requests: Array<AutosaveQueueItem<string> & { expectedRevision: number }> = [];
      const first = deferred<{ outcome: "formal" | "draft"; revision: number }>();
      let revision = 1;
      let operation = 0;
      const queue = new LatestAutosaveQueue<string, { outcome: "formal" | "draft"; revision: number }>({
        debounceMs: 25,
        createOperationId: () => `op-${++operation}`,
        submit: (item) => {
          requests.push({ ...item, expectedRevision: revision });
          return item.snapshot === "A"
            ? first.promise
            : Promise.resolve({ outcome, revision: revision + 1 });
        },
        onResult: (_item, result) => {
          revision = result.revision;
        },
        onError: () => undefined,
      });

      queue.edit("A");
      await vi.advanceTimersByTimeAsync(25);
      expect(requests.map((request) => request.snapshot)).toEqual(["A"]);

      queue.edit("B");
      await vi.advanceTimersByTimeAsync(25);
      expect(requests.map((request) => request.snapshot)).toEqual(["A"]);

      first.resolve({ outcome, revision: 2 });
      await settle();

      expect(requests.map((request) => request.snapshot)).toEqual(["A", "B"]);
      expect(requests[1]).toMatchObject({ expectedRevision: 2 });
      queue.dispose();
    },
  );

  it("does not let an older error cancel or mark a newer dirty edit saved", async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const requests: AutosaveQueueItem<string>[] = [];
    const visibleStates: string[] = [];
    let operation = 0;
    const queue = new LatestAutosaveQueue<string, string>({
      debounceMs: 25,
      createOperationId: () => `op-${++operation}`,
      submit: (item) => {
        requests.push(item);
        return item.snapshot === "A" ? first.promise : Promise.resolve("B-saved");
      },
      onResult: (item, _result, isLatest) => {
        if (isLatest) visibleStates.push(`${item.snapshot}:saved`);
      },
      onError: (item, _error, isLatest) => {
        if (isLatest) visibleStates.push(`${item.snapshot}:error`);
      },
      isUnknownOutcome: () => false,
    });

    queue.edit("A");
    await vi.advanceTimersByTimeAsync(25);
    queue.edit("B");
    await vi.advanceTimersByTimeAsync(25);
    first.reject(new Error("A failed"));
    await settle();

    expect(requests.map((request) => request.snapshot)).toEqual(["A", "B"]);
    expect(visibleStates).toEqual(["B:saved"]);
    queue.dispose();
  });

  it("flushes a debounced edit and waits for its acknowledgement before closing", async () => {
    vi.useFakeTimers();
    const request = deferred<string>();
    const submitted: string[] = [];
    const queue = new LatestAutosaveQueue<string, string>({
      debounceMs: 10_000,
      createOperationId: () => "close-operation",
      submit: (item) => {
        submitted.push(item.snapshot);
        return request.promise;
      },
      onResult: () => undefined,
      onError: () => undefined,
      isUnknownOutcome: () => false,
    });

    queue.edit("last edit");
    const closing = queue.flushAndWait();
    await settle();
    expect(submitted).toEqual(["last edit"]);
    request.resolve("saved");
    await expect(closing).resolves.toBe(true);
    queue.dispose();
  });

  it("keeps the editor open when the flushed latest edit fails", async () => {
    vi.useFakeTimers();
    const queue = new LatestAutosaveQueue<string, string>({
      debounceMs: 10_000,
      createOperationId: () => "failed-close-operation",
      submit: async () => { throw new TypeError("offline"); },
      onResult: () => undefined,
      onError: () => undefined,
      isUnknownOutcome: () => false,
    });

    queue.edit("unsaved");
    await expect(queue.flushAndWait()).resolves.toBe(false);
    queue.dispose();
  });

  it("does not invoke client callbacks when an in-flight request settles after disposal", async () => {
    vi.useFakeTimers();
    const request = deferred<string>();
    const onResult = vi.fn();
    const onError = vi.fn();
    const queue = new LatestAutosaveQueue<string, string>({
      debounceMs: 1,
      createOperationId: () => "disposed-operation",
      submit: () => request.promise,
      onResult,
      onError,
      isUnknownOutcome: () => false,
    });

    queue.edit("A");
    await vi.advanceTimersByTimeAsync(1);
    queue.dispose();
    request.resolve("saved");
    await settle();

    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reuses the operation id when retrying an unknown network outcome", async () => {
    vi.useFakeTimers();
    const operationIds: string[] = [];
    let attempt = 0;
    const queue = new LatestAutosaveQueue<string, string>({
      debounceMs: 1,
      createOperationId: () => "stable-operation-id",
      submit: async (item) => {
        operationIds.push(item.operationId);
        attempt += 1;
        if (attempt === 1) throw new TypeError("network response lost");
        return "saved";
      },
      onResult: () => undefined,
      onError: () => undefined,
      isUnknownOutcome: () => true,
      unknownOutcomeRetries: 1,
    });

    queue.edit("A");
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(operationIds).toEqual(["stable-operation-id", "stable-operation-id"]);
    queue.dispose();
  });
});
