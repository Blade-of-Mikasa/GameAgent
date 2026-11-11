import { randomUUID } from "node:crypto";
import type {
  Action,
  ActionResult,
  DecisionRequest,
  GameEvent,
  GameState,
  InvalidationReason,
  Observation,
} from "../contracts/index.js";
import type { GameAdapter } from "./adapters/index.js";
import { ActionExecutor } from "./executor.js";
import { RequestManager, type InvalidatedRequest } from "./requests.js";
import { StateStore } from "./state.js";

export interface GameSDK {
  onEvent(listener: (event: GameEvent) => void): () => void;
  getState(): GameState | undefined;
  getPendingRequests(): DecisionRequest[];
  start(): Promise<void>;
  execute(action: Action, signal?: AbortSignal): Promise<ActionResult>;
  invalidateRequest(requestId: string, reason: InvalidationReason): void;
  stop(): Promise<void>;
}

export function createSDK(
  adapter: GameAdapter,
  options: { now?: () => number; confirmationTimeoutMs?: number } = {},
): GameSDK {
  const now = options.now ?? Date.now;
  const state = new StateStore();
  const requests = new RequestManager(now);
  const listeners = new Set<(event: GameEvent) => void>();
  const lifecycle = new AbortController();
  let started = false;
  let stopped = false;
  const publish = (event: GameEvent): void => {
    for (const listener of listeners) listener(structuredClone(event));
  };
  const metadata = (gameId: string) => ({
    id: randomUUID(),
    gameId,
    at: now(),
  });
  const invalidate = (item: InvalidatedRequest | undefined): void => {
    if (item)
      publish({
        ...metadata(item.request.gameId),
        type: "request_invalidated",
        requestId: item.request.id,
        reason: item.reason,
      });
  };
  const executor = new ActionExecutor(
    adapter,
    state,
    requests,
    (result) => {
      publish({ ...metadata(result.gameId), type: "action_result", result });
    },
    now,
    options.confirmationTimeoutMs,
  );

  function observe(observation: Observation): void {
    if (stopped) return;
    const applied = state.apply(observation);
    if (!applied) return;
    // Reconcile before notifying subscribers so reads see the new request state.
    const changes = requests.reconcile(applied.state);
    publish({
      ...metadata(applied.state.gameId),
      type: "observation",
      observation,
      ...applied,
    });
    for (const item of changes.invalidated) invalidate(item);
    if (changes.created)
      publish({
        ...metadata(applied.state.gameId),
        type: "decision_requested",
        request: changes.created,
      });
  }

  return {
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state.get(),
    getPendingRequests: () => requests.pending(),
    async start() {
      if (stopped) throw new Error("Create a new SDK session after stopping");
      if (started) return;
      started = true;
      await adapter.start(observe);
    },
    execute: (action, signal) =>
      executor.execute(
        action,
        signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal,
      ),
    invalidateRequest: (id, reason) =>
      invalidate(requests.invalidate(id, reason)),
    async stop() {
      if (stopped) return;
      stopped = true;
      lifecycle.abort(new Error("SDK stopped"));
      for (const request of requests.pending())
        invalidate(requests.invalidate(request.id, "stopped"));
      await adapter.stop();
    },
  };
}
