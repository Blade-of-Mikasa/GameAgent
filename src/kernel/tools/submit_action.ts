import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, str } from "@earendil-works/pi-schema";
import type { Action, DecisionRequest } from "../../contracts/index.js";

const parameters = obj({
  optionId: str({
    minLength: 1,
    description: "ID of one of the request's legalActions",
  }),
});

/** The tool deliberately receives no SDK, adapter or game-control capability. */
export function createSubmitActionTool(
  request: DecisionRequest,
  record: (action: Action) => void,
): AgentTool<typeof parameters> {
  let selected = false;
  return {
    name: "submit_action",
    label: "Record action",
    parameters,
    description:
      "Record exactly one legal game action. This does not execute the action.",
    executionMode: "sequential",
    async execute(_toolCallId, { optionId }, signal) {
      signal?.throwIfAborted();
      if (Date.now() >= request.deadlineAt)
        throw new Error("Decision window expired");
      if (selected) throw new Error("An action has already been selected");
      const choice = request.legalActions.find(
        (option) => option.id === optionId,
      );
      if (!choice) throw new Error(`Unknown legal action: ${optionId}`);
      const action: Action = {
        id: randomUUID(),
        gameId: request.gameId,
        requestId: request.id,
        stateVersion: request.stateVersion,
        choice: structuredClone(choice),
      };
      record(action);
      selected = true;
      return {
        content: [
          {
            type: "text",
            text: "Selection recorded; execution is pending in the App.",
          },
        ],
        details: { actionId: action.id, optionId },
        terminate: true,
      };
    },
  };
}
