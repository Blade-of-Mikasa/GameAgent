import { randomUUID } from "node:crypto";
import type {
  Action,
  GameFact,
  GameSnapshot,
  Observation,
} from "../../contracts/index.js";
import type { ExecutionReceipt, GameAdapter } from "./index.js";

export interface SimulatorOptions {
  gameId?: string;
  turns?: number;
  windowMs?: number;
  now?: () => number;
}

/** A deliberately small deterministic duel, not a complete Sanguosha rules engine. */
export class SimulatorAdapter implements GameAdapter {
  private emit: ((observation: Observation) => void) | undefined;
  private snapshot: GameSnapshot;
  private sequence = 0;
  private readonly now: () => number;
  private readonly turns: number;
  private readonly windowMs: number;
  readonly executedActions: Action[] = [];

  constructor(options: SimulatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.turns = options.turns ?? 3;
    this.windowMs = options.windowMs ?? 30_000;
    if (!Number.isSafeInteger(this.turns) || this.turns < 1)
      throw new Error("Simulator turns must be positive");
    this.snapshot = {
      gameId: options.gameId ?? randomUUID(),
      playerId: "player-1",
      activePlayerId: "player-1",
      turn: 1,
      phase: "play",
      players: [
        {
          id: "player-1",
          name: "Agent",
          hp: this.turns,
          maxHp: this.turns,
          handCount: 1,
        },
        {
          id: "player-2",
          name: "Opponent",
          hp: this.turns,
          maxHp: this.turns,
          handCount: 0,
        },
      ],
      hand: [{ id: "slash-1", name: "杀" }],
    };
  }

  async start(emit: (observation: Observation) => void): Promise<void> {
    this.emit = emit;
    this.openWindow();
    this.publish([]);
  }

  private openWindow(): void {
    const cardId = `slash-${this.snapshot.turn}`;
    this.snapshot = {
      ...this.snapshot,
      hand: [{ id: cardId, name: "杀" }],
      window: {
        id: `turn-${this.snapshot.turn}`,
        kind: "play",
        playerId: "player-1",
        deadlineAt: this.now() + this.windowMs,
        legalActions: [
          { id: "pass", kind: "pass", targetIds: [] },
          { id: "attack", kind: "play_card", cardId, targetIds: ["player-2"] },
        ],
      },
    };
  }

  private publish(facts: GameFact[]): void {
    this.emit?.({
      id: randomUUID(),
      source: "simulator",
      sequence: ++this.sequence,
      observedAt: this.now(),
      snapshot: structuredClone(this.snapshot),
      facts,
    });
  }

  async execute(
    action: Action,
    signal: AbortSignal,
  ): Promise<ExecutionReceipt> {
    signal.throwIfAborted();
    if (!this.emit || this.snapshot.phase === "finished")
      throw new Error("Simulator is not running");
    this.executedActions.push(structuredClone(action));
    const attack = action.choice.kind === "play_card";
    const players = this.snapshot.players.map((player) => ({
      ...player,
      hp: Math.max(
        0,
        player.hp -
          ((attack && player.id === "player-2") ||
          (!attack && player.id === "player-1")
            ? 1
            : 0),
      ),
    }));
    const facts: GameFact[] = [
      {
        id: randomUUID(),
        at: this.now(),
        kind: attack ? "attack" : "pass",
        actorId: "player-1",
        ...(attack ? { targetId: "player-2", cardName: "杀" } : {}),
      },
    ];
    const finished =
      this.snapshot.turn >= this.turns ||
      players.some((player) => player.hp === 0);
    const { window: _window, ...previous } = this.snapshot;
    this.snapshot = {
      ...previous,
      players,
      turn: previous.turn + (finished ? 0 : 1),
      phase: finished ? "finished" : "play",
    };
    if (finished) {
      const self = players[0]!;
      const opponent = players[1]!;
      this.snapshot = {
        ...this.snapshot,
        hand: [],
        players: players.map((p) => ({ ...p, handCount: 0 })),
        winnerId: self.hp > opponent.hp ? self.id : opponent.id,
      };
    } else {
      this.openWindow();
    }
    this.publish(facts);
    return {
      actionId: action.id,
      confirmed: true,
      message: "Simulator confirmed the action",
    };
  }

  async stop(): Promise<void> {
    this.emit = undefined;
  }
}
