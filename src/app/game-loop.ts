import type {
  ActionResult,
  DecisionRequest,
  GameEvent,
  InvalidationReason,
} from "../contracts/index.js";
import type { DecisionKernel } from "../kernel/index.js";
import type { GameSDK } from "../sdk/index.js";

export interface DecisionRun {
  requestId: string;
  status: ActionResult["status"] | "timeout" | "cancelled" | "failed";
  durationMs: number;
  result?: ActionResult;
  error?: string;
}

export interface GameLoopOptions {
  decisionBudgetMs?: number;
  onEvent?: (event: GameEvent) => void;
  onDecision?: (decision: DecisionRun) => void;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** App is the only place that connects a decision to execution. */
export class GameLoop {
  private unsubscribe: (() => void) | undefined;
  private queue = Promise.resolve();
  private readonly scheduled = new Set<string>();
  private active:
    | {
        requestId: string;
        controller: AbortController;
        reason: InvalidationReason | undefined;
      }
    | undefined;
  private stopped = false;
  private ready = false;
  private stopping: Promise<void> | undefined;
  private readonly budgetMs: number;
  readonly decisions: DecisionRun[] = [];

  constructor(
    private readonly sdk: GameSDK,
    private readonly kernel: DecisionKernel,
    private readonly options: GameLoopOptions = {},
  ) {
    this.budgetMs = options.decisionBudgetMs ?? 10_000;
    if (
      !Number.isSafeInteger(this.budgetMs) ||
      this.budgetMs < 1 ||
      this.budgetMs > 2_147_483_647
    )
      throw new Error("Decision budget must be a positive timer duration");
  }

  async start(): Promise<void> {
    if (this.stopped) throw new Error("Create a new game loop after stopping");
    if (this.unsubscribe) return;
    this.unsubscribe = this.sdk.onEvent((event) => this.onEvent(event));
    try {
      await this.sdk.start();
      this.ready = true;
      for (const request of this.sdk.getPendingRequests())
        this.enqueue(request);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** Drains requests added by execution observations as well as initial requests. */
  async waitForIdle(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.cancelActive("stopped");
    this.stopping = (async () => {
      try {
        await this.sdk.stop();
        await this.waitForIdle();
      } finally {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    })();
    return this.stopping;
  }

  private cancelActive(reason: InvalidationReason): void {
    if (!this.active) return;
    this.active.reason = reason;
    this.active.controller.abort(new Error(reason));
    this.kernel.cancel(this.active.requestId);
  }

  private onEvent(event: GameEvent): void {
    this.kernel.onEvent(event);
    this.options.onEvent?.(event);
    if (
      event.type === "request_invalidated" &&
      event.requestId === this.active?.requestId
    )
      this.cancelActive(event.reason);
    if (event.type === "decision_requested" && this.ready && !this.stopped)
      this.enqueue(event.request);
  }

  private enqueue(request: DecisionRequest): void {
    if (this.scheduled.has(request.id)) return;
    this.scheduled.add(request.id);
    // Queue time counts against the decision budget.
    const deadline = Math.min(request.deadlineAt, Date.now() + this.budgetMs);
    this.queue = this.queue.then(() => this.process(request, deadline));
  }

  private async process(
    request: DecisionRequest,
    deadline: number,
  ): Promise<void> {
    if (
      this.stopped ||
      !this.sdk.getPendingRequests().some((entry) => entry.id === request.id)
    )
      return;
    const start = performance.now();
    const job = {
      requestId: request.id,
      controller: new AbortController(),
      reason: undefined as InvalidationReason | undefined,
    };
    this.active = job;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let record: DecisionRun;
    try {
      if (Date.now() >= deadline) {
        this.cancelActive("timeout");
        job.controller.signal.throwIfAborted();
      }
      timer = setTimeout(
        () => this.cancelActive("timeout"),
        Math.max(0, deadline - Date.now()),
      );
      const action = await abortable(
        this.kernel.decide(request, job.controller.signal),
        job.controller.signal,
      );
      clearTimeout(timer);
      job.controller.signal.throwIfAborted();
      // Wall-clock recheck prevents late results when the event loop delayed the timer.
      if (Date.now() >= deadline) {
        this.cancelActive("timeout");
        job.controller.signal.throwIfAborted();
      }
      if (
        action.requestId !== request.id ||
        action.gameId !== request.gameId ||
        action.stateVersion !== request.stateVersion
      ) {
        throw new Error("Kernel returned an action for a different request");
      }
      const result = await this.sdk.execute(action, job.controller.signal);
      this.kernel.observeResult(result);
      if (result.status === "rejected")
        this.sdk.invalidateRequest(request.id, "decision_failed");
      record = {
        requestId: request.id,
        status: result.status,
        result,
        durationMs: performance.now() - start,
      };
    } catch (error) {
      const status =
        job.reason === "timeout"
          ? "timeout"
          : job.controller.signal.aborted
            ? "cancelled"
            : "failed";
      this.sdk.invalidateRequest(
        request.id,
        status === "timeout"
          ? "timeout"
          : status === "cancelled"
            ? "cancelled"
            : "decision_failed",
      );
      record = {
        requestId: request.id,
        status,
        durationMs: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
      if (this.active === job) this.active = undefined;
    }
    this.decisions.push(record);
    this.options.onDecision?.(structuredClone(record));
  }
}
