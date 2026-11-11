import type {
  GameSnapshot,
  GameState,
  Observation,
} from "../contracts/index.js";

/** Stable key order avoids version bumps caused by parser property ordering. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return item;
  });
}

function validate(snapshot: GameSnapshot): void {
  const ids = snapshot.players.map((player) => player.id);
  if (
    !snapshot.gameId ||
    !ids.includes(snapshot.playerId) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Invalid game/player identity in observation");
  }
  if (
    snapshot.players.some(
      (p) => !Number.isFinite(p.hp) || p.hp < 0 || p.hp > p.maxHp,
    )
  ) {
    throw new Error("Invalid player health in observation");
  }
  if (snapshot.window) {
    const { id, playerId, deadlineAt, legalActions } = snapshot.window;
    if (!id || !ids.includes(playerId) || !Number.isFinite(deadlineAt)) {
      throw new Error("Invalid decision window");
    }
    if (
      new Set(legalActions.map((choice) => choice.id)).size !==
      legalActions.length
    ) {
      throw new Error("Duplicate action choices");
    }
    for (const choice of legalActions) {
      if (
        !choice.id ||
        choice.targetIds.some((target) => !ids.includes(target))
      ) {
        throw new Error("Invalid action choice");
      }
      if (
        playerId === snapshot.playerId &&
        choice.cardId &&
        !snapshot.hand.some((card) => card.id === choice.cardId)
      ) {
        throw new Error("Action refers to an invisible card");
      }
    }
  }
}

export class StateStore {
  private state: GameState | undefined;
  private sequence = -1;
  private fingerprint = "";

  get(): GameState | undefined {
    return this.state && structuredClone(this.state);
  }

  apply(
    observation: Observation,
  ): { state: GameState; changed: boolean } | undefined {
    if (
      !Number.isSafeInteger(observation.sequence) ||
      observation.sequence < 0
    ) {
      throw new Error("Observation sequence must be a non-negative integer");
    }
    if (observation.sequence <= this.sequence) return undefined;
    validate(observation.snapshot);
    const fingerprint = canonical(observation.snapshot);
    const changed = fingerprint !== this.fingerprint;
    if (changed) {
      this.state = {
        ...structuredClone(observation.snapshot),
        version: (this.state?.version ?? 0) + 1,
      };
      this.fingerprint = fingerprint;
    }
    this.sequence = observation.sequence;
    return { state: this.get()!, changed };
  }
}
