import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { DecisionRequest } from "../contracts/index.js";

export type OfflineStrategy = "first_legal" | "prefer_attack";

/** Script only the model transport; Pi still validates and executes both tools. */
export function createOfflineModel(
  request: DecisionRequest,
  strategy: OfflineStrategy,
) {
  const provider = fauxProvider({
    models: [{ id: "offline-game-policy", name: "Offline game policy" }],
  });
  const models = createModels();
  models.setProvider(provider.provider);
  const choice =
    (strategy === "prefer_attack"
      ? request.legalActions.find((option) => option.kind === "play_card")
      : undefined) ?? request.legalActions[0];
  if (!choice) throw new Error("No legal actions in request");
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("query_rules", { query: request.kind }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("submit_action", { optionId: choice.id }),
      { stopReason: "toolUse" },
    ),
  ]);
  return { models, model: provider.getModel() };
}
