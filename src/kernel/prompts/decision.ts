import type { DecisionContext } from "../context.js";

const instructions = {
  play: "Choose the best legal play for this turn, or pass if appropriate.",
  response:
    "Choose a legal response to the current interruption before its deadline.",
};

export function decisionPrompt(context: DecisionContext): string {
  return JSON.stringify({
    instruction: instructions[context.request.kind],
    ...context,
  });
}
