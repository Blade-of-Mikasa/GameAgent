import type { Action, ActionResult } from "../contracts/index.js";
import type { GameAdapter } from "./adapters/index.js";
import type { RequestManager } from "./requests.js";
import { canonical, type StateStore } from "./state.js";

export class ActionExecutor {
  private readonly attempts = new Map<
    string,
    { fingerprint: string; result: Promise<ActionResult> }
  >();

  constructor(
    private readonly adapter: GameAdapter,
    private readonly state: StateStore,
    private readonly requests: RequestManager,
    private readonly publish: (result: ActionResult) => void,
    private readonly now: () => number = Date.now,
    private readonly confirmationTimeoutMs = 2000,
  ) {}

  execute(input: Action, signal?: AbortSignal): Promise<ActionResult> {
    const action = structuredClone(input);
    const fingerprint = canonical(action);
    const existing = this.attempts.get(action.id);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.result.then((result) => structuredClone(result))
        : Promise.resolve(
            this.result(
              action,
              "rejected",
              "action_id_conflict",
              "Action ID was already used for a different command",
            ),
          );
    }
    // Schedule dispatch after registering the attempt, including re-entrant observers.
    const result = Promise.resolve()
      .then(() => this.dispatch(action, signal))
      .then((value) => {
        this.publish(value);
        return value;
      });
    this.attempts.set(action.id, { fingerprint, result });
    return result.then((value) => structuredClone(value));
  }

  private result(
    action: Action,
    status: ActionResult["status"],
    code: string,
    message: string,
  ): ActionResult {
    const state = this.state.get();
    return {
      actionId: action.id,
      requestId: action.requestId,
      gameId: action.gameId,
      status,
      code,
      message,
      completedAt: this.now(),
      ...(state ? { stateVersion: state.version } : {}),
    };
  }

  private async dispatch(
    action: Action,
    parentSignal?: AbortSignal,
  ): Promise<ActionResult> {
    if (parentSignal?.aborted)
      return this.result(
        action,
        "rejected",
        "cancelled",
        "Cancelled before dispatch",
      );
    const request = this.requests.getPending(action.requestId);
    if (!request)
      return this.result(
        action,
        "rejected",
        "request_unavailable",
        "Request is no longer pending",
      );
    if (this.now() >= request.deadlineAt)
      return this.result(
        action,
        "rejected",
        "expired",
        "Decision window expired",
      );
    const state = this.state.get();
    if (
      action.gameId !== request.gameId ||
      state?.gameId !== action.gameId ||
      action.stateVersion !== request.stateVersion ||
      state.version !== action.stateVersion
    ) {
      return this.result(
        action,
        "rejected",
        "stale_state",
        "Action does not match the current game state",
      );
    }
    const choice = request.legalActions.find(
      (option) => option.id === action.choice.id,
    );
    if (!choice || canonical(choice) !== canonical(action.choice)) {
      return this.result(
        action,
        "rejected",
        "illegal_action",
        "Action is not one of the current legal choices",
      );
    }
    if (!this.requests.claim(request.id))
      return this.result(
        action,
        "rejected",
        "request_unavailable",
        "Request was already consumed",
      );

    const controller = new AbortController();
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, controller.signal])
      : controller.signal;
    const timeout = setTimeout(
      () => controller.abort(new Error("Execution confirmation timed out")),
      Math.min(this.confirmationTimeoutMs, request.deadlineAt - this.now()),
    );
    let onAbort: () => void = () => {};
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const receipt = await Promise.race([
        this.adapter.execute(action, signal),
        cancelled,
      ]);
      if (
        signal.aborted ||
        !receipt.confirmed ||
        receipt.actionId !== action.id
      ) {
        return this.result(
          action,
          "unknown",
          "unconfirmed",
          "Dispatched, but the matching game acknowledgement was not confirmed",
        );
      }
      return this.result(action, "succeeded", "confirmed", receipt.message);
    } catch (error) {
      const code = controller.signal.aborted
        ? "confirmation_timeout"
        : signal.aborted
          ? "cancelled_after_dispatch"
          : "adapter_error";
      return this.result(
        action,
        "unknown",
        code,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      this.requests.complete(request.id);
    }
  }
}
