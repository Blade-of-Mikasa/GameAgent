import type {
  ActionResult,
  GameEvent,
  GameFact,
  GameState,
} from "../contracts/index.js";

export interface IdentityBelief {
  playerId: string;
  role: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface HandBelief {
  playerId: string;
  cardName: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface GameMemorySnapshot {
  events: GameEvent[];
  facts: GameFact[];
  results: ActionResult[];
  identities: IdentityBelief[];
  hands: HandBelief[];
  state?: GameState;
}

/** Game history outlives model conversations. Beliefs never become observed facts. */
export class GameMemory {
  private readonly games = new Map<string, GameMemorySnapshot>();
  private readonly eventIds = new Set<string>();

  private game(id: string): GameMemorySnapshot {
    let memory = this.games.get(id);
    if (!memory) {
      memory = {
        events: [],
        facts: [],
        results: [],
        identities: [],
        hands: [],
      };
      this.games.set(id, memory);
    }
    return memory;
  }

  record(event: GameEvent): void {
    if (this.eventIds.has(event.id)) return;
    this.eventIds.add(event.id);
    const memory = this.game(event.gameId);
    memory.events.push(structuredClone(event));
    if (event.type === "observation") {
      memory.state = structuredClone(event.state);
      const known = new Set(memory.facts.map((fact) => fact.id));
      for (const fact of event.observation.facts) {
        if (!known.has(fact.id)) {
          memory.facts.push(structuredClone(fact));
          known.add(fact.id);
        }
      }
    }
  }

  recordResult(result: ActionResult): void {
    const results = this.game(result.gameId).results;
    if (!results.some((entry) => entry.actionId === result.actionId))
      results.push(structuredClone(result));
  }

  setIdentityBelief(gameId: string, belief: IdentityBelief): void {
    this.validateConfidence(belief.confidence);
    const game = this.game(gameId);
    game.identities = game.identities.filter(
      (entry) => entry.playerId !== belief.playerId,
    );
    game.identities.push(structuredClone(belief));
  }

  setHandBelief(gameId: string, belief: HandBelief): void {
    this.validateConfidence(belief.confidence);
    const game = this.game(gameId);
    game.hands = game.hands.filter(
      (entry) =>
        entry.playerId !== belief.playerId ||
        entry.cardName !== belief.cardName,
    );
    game.hands.push(structuredClone(belief));
  }

  snapshot(gameId: string): GameMemorySnapshot {
    return structuredClone(this.game(gameId));
  }

  private validateConfidence(confidence: number): void {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      throw new Error("Belief confidence must be between 0 and 1");
  }
}
