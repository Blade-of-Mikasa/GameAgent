import type {
  Action,
  DecisionRequest,
  GameSnapshot,
  Observation,
} from "../src/contracts/index.js";
import type {
  ExecutionReceipt,
  GameAdapter,
} from "../src/sdk/adapters/index.js";

export function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    gameId: "game-1",
    playerId: "p1",
    turn: 1,
    phase: "play",
    activePlayerId: "p1",
    players: [
      { id: "p1", name: "Self", hp: 3, maxHp: 3, handCount: 1 },
      { id: "p2", name: "Other", hp: 3, maxHp: 3, handCount: 1 },
    ],
    hand: [{ id: "c1", name: "杀" }],
    window: {
      id: "w1",
      playerId: "p1",
      kind: "play",
      deadlineAt: Date.now() + 60_000,
      legalActions: [
        { id: "attack", kind: "play_card", cardId: "c1", targetIds: ["p2"] },
        { id: "pass", kind: "pass", targetIds: [] },
      ],
    },
    ...overrides,
  };
}

export function observation(sequence = 1, state = snapshot()): Observation {
  return {
    id: `obs-${sequence}`,
    source: "simulator",
    sequence,
    observedAt: Date.now(),
    snapshot: state,
    facts: [],
  };
}

export function actionFor(
  request: DecisionRequest,
  id = "action-1",
  choiceIndex = 0,
): Action {
  return {
    id,
    gameId: request.gameId,
    requestId: request.id,
    stateVersion: request.stateVersion,
    choice: structuredClone(request.legalActions[choiceIndex]!),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class ManualAdapter implements GameAdapter {
  private emit: ((observation: Observation) => void) | undefined;
  calls: Action[] = [];
  stopped = false;
  behavior?: (action: Action, signal: AbortSignal) => Promise<ExecutionReceipt>;
  constructor(readonly initial = observation()) {}
  async start(emit: (observation: Observation) => void): Promise<void> {
    this.emit = emit;
    emit(this.initial);
  }
  push(value: Observation): void {
    this.emit?.(value);
  }
  async execute(
    action: Action,
    signal: AbortSignal,
  ): Promise<ExecutionReceipt> {
    this.calls.push(action);
    return this.behavior
      ? this.behavior(action, signal)
      : { actionId: action.id, confirmed: true, message: "Acknowledged" };
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.emit = undefined;
  }
}
