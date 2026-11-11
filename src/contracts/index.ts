/** Framework-free, JSON-serializable data shared by SDK, Kernel and App. */
export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly handCount: number;
  readonly revealedRole?: string;
}

export interface Card {
  readonly id: string;
  readonly name: string;
}

export interface ActionChoice {
  readonly id: string;
  readonly kind: "play_card" | "respond" | "pass";
  readonly cardId?: string;
  readonly targetIds: readonly string[];
}

export interface DecisionWindow {
  /** Unique per opportunity within a game; adapters must not reuse closed IDs. */
  readonly id: string;
  readonly playerId: string;
  readonly kind: "play" | "response";
  readonly deadlineAt: number;
  readonly legalActions: readonly ActionChoice[];
}

export interface GameSnapshot {
  readonly gameId: string;
  readonly playerId: string;
  readonly turn: number;
  readonly phase: "waiting" | "play" | "response" | "finished";
  readonly activePlayerId: string;
  readonly players: readonly PlayerState[];
  /** Only the controlled player's visible hand. */
  readonly hand: readonly Card[];
  readonly window?: DecisionWindow;
  readonly winnerId?: string;
}

export interface GameFact {
  readonly id: string;
  readonly at: number;
  readonly kind: "attack" | "card_played" | "role_revealed" | "pass";
  readonly actorId: string;
  readonly targetId?: string;
  readonly cardName?: string;
  readonly role?: string;
}

export interface Observation {
  readonly id: string;
  readonly source: "simulator" | "screenshot" | "protocol";
  /** Strictly increasing across this adapter session, including game changes. */
  readonly sequence: number;
  readonly observedAt: number;
  readonly snapshot: GameSnapshot;
  readonly facts: readonly GameFact[];
  readonly screenshotPath?: string;
}

export interface GameState extends GameSnapshot {
  /** Increases only when the normalized snapshot changes. */
  readonly version: number;
}

export interface DecisionRequest {
  readonly id: string;
  readonly gameId: string;
  readonly windowId: string;
  readonly playerId: string;
  readonly kind: DecisionWindow["kind"];
  readonly stateVersion: number;
  readonly createdAt: number;
  readonly deadlineAt: number;
  readonly legalActions: readonly ActionChoice[];
  readonly state: GameState;
}

/** A game command, independent of a model's tool-call format. */
export interface Action {
  readonly id: string;
  readonly gameId: string;
  readonly requestId: string;
  readonly stateVersion: number;
  readonly choice: ActionChoice;
}

export interface ActionResult {
  readonly actionId: string;
  readonly requestId: string;
  readonly gameId: string;
  /** unknown means dispatch happened but its effect could not be confirmed. */
  readonly status: "succeeded" | "rejected" | "unknown";
  readonly code: string;
  readonly message: string;
  readonly completedAt: number;
  readonly stateVersion?: number;
}

export type InvalidationReason =
  "state_changed" | "timeout" | "cancelled" | "decision_failed" | "stopped";

interface EventMetadata {
  readonly id: string;
  readonly gameId: string;
  readonly at: number;
}

export type GameEvent = EventMetadata &
  (
    | {
        readonly type: "observation";
        readonly observation: Observation;
        readonly state: GameState;
        readonly changed: boolean;
      }
    | { readonly type: "decision_requested"; readonly request: DecisionRequest }
    | {
        readonly type: "request_invalidated";
        readonly requestId: string;
        readonly reason: InvalidationReason;
      }
    | { readonly type: "action_result"; readonly result: ActionResult }
  );
