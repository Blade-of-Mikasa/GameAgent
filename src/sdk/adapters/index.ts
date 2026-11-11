import type { Action, Observation } from "../../contracts/index.js";

export interface ExecutionReceipt {
  readonly actionId: string;
  readonly confirmed: boolean;
  readonly message: string;
}

/** Adapters normalize observations and own all interaction with the game. */
export interface GameAdapter {
  start(emit: (observation: Observation) => void): Promise<void>;
  execute(action: Action, signal: AbortSignal): Promise<ExecutionReceipt>;
  stop(): Promise<void>;
}
