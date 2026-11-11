import type {
  Action,
  ActionResult,
  DecisionRequest,
  GameEvent,
} from "../contracts/index.js";
import { buildContext, RuleBook } from "./context.js";
import { GameMemory } from "./memory.js";
import { PiRuntime, type RuntimeOptions } from "./runtime.js";

export type { DecisionUsage, KernelTrace } from "./runtime.js";

export interface DecisionKernel {
  onEvent(event: GameEvent): void;
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<Action>;
  cancel(requestId?: string): void;
  observeResult(result: ActionResult): void;
}

export interface KernelOptions extends RuntimeOptions {
  memory?: GameMemory;
  rules?: RuleBook;
}

export function createKernel(options: KernelOptions = {}): DecisionKernel {
  const memory = options.memory ?? new GameMemory();
  const rules = options.rules ?? new RuleBook();
  const runtime = new PiRuntime(options);
  return {
    onEvent: (event) => memory.record(event),
    decide: (request, signal) =>
      runtime.decide(
        request,
        buildContext(request, memory, rules),
        rules,
        signal,
      ),
    cancel: (requestId) => runtime.cancel(requestId),
    observeResult: (result) => memory.recordResult(result),
  };
}
