import rules from "../../knowledge/rules.json" with { type: "json" };
import type { DecisionRequest } from "../contracts/index.js";
import type { GameMemory } from "./memory.js";

export interface Rule {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly tags: readonly string[];
}

export class RuleBook {
  constructor(private readonly entries: readonly Rule[] = rules) {}

  query(query: string, limit = 5): Rule[] {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return structuredClone(
      this.entries
        .filter((rule) => {
          const text =
            `${rule.id} ${rule.title} ${rule.text} ${rule.tags.join(" ")}`.toLocaleLowerCase();
          return (
            terms.length === 0 || terms.some((term) => text.includes(term))
          );
        })
        .slice(0, limit),
    );
  }
}

export function buildContext(
  request: DecisionRequest,
  memory: GameMemory,
  rules: RuleBook,
  historyLimit = 20,
) {
  const game = memory.snapshot(request.gameId);
  const visiblePlayers = new Set(
    request.state.players.map((player) => player.id),
  );
  return {
    request: structuredClone(request),
    history: game.facts.slice(-historyLimit),
    historySummary: {
      totalFacts: game.facts.length,
      includedFacts: Math.min(historyLimit, game.facts.length),
    },
    recentResults: game.results.slice(-5),
    beliefs: {
      identities: game.identities.filter((belief) =>
        visiblePlayers.has(belief.playerId),
      ),
      hands: game.hands.filter((belief) => visiblePlayers.has(belief.playerId)),
    },
    rules: rules.query(request.kind),
  };
}

export type DecisionContext = ReturnType<typeof buildContext>;
