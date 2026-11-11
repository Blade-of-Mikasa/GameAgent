import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, str } from "@earendil-works/pi-schema";
import type { RuleBook } from "../context.js";

const parameters = obj({ query: str({ minLength: 1, maxLength: 200 }) });

export function createQueryRulesTool(
  rules: RuleBook,
): AgentTool<typeof parameters> {
  return {
    name: "query_rules",
    label: "Query game rules",
    parameters,
    description:
      "Look up relevant rules. Results state the scope of the supported game.",
    async execute(_toolCallId, { query }, signal) {
      signal?.throwIfAborted();
      const matches = rules.query(query);
      return {
        content: [{ type: "text", text: JSON.stringify(matches) }],
        details: { ruleIds: matches.map((rule) => rule.id) },
      };
    },
  };
}
