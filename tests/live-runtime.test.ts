import assert from "node:assert/strict";
import test from "node:test";
import { createKernel, type DecisionUsage } from "../src/kernel/index.js";
import { createSDK } from "../src/sdk/index.js";
import { ManualAdapter } from "./helpers.js";

test("live provider wiring forwards credentials and consumes a streamed tool call without network access", async (t) => {
  let calls = 0;
  const usage: DecisionUsage[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(new URL(request.url).hostname, "api.anthropic.com");
      assert.equal(request.headers.get("x-api-key"), "fixture-api-key");
      const payload = (await request.json()) as {
        model: string;
        stream: boolean;
        tools: { name: string }[];
      };
      assert.equal(payload.model, "claude-sonnet-4-6");
      assert.equal(payload.stream, true);
      assert.ok(payload.tools.some((tool) => tool.name === "submit_action"));
      const events = [
        {
          type: "message_start",
          message: {
            id: "fixture-message",
            type: "message",
            role: "assistant",
            content: [],
            model: payload.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "fixture-tool",
            name: "submit_action",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify({ optionId: "attack" }),
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 20 },
        },
        { type: "message_stop" },
      ];
      return new Response(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  );
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  await sdk.start();
  try {
    const kernel = createKernel({
      mode: "live",
      provider: "anthropic",
      apiKey: "fixture-api-key",
      onUsage: (entry) => usage.push(entry),
    });
    const action = await kernel.decide(
      sdk.getPendingRequests()[0]!,
      AbortSignal.timeout(3000),
    );
    assert.equal(action.choice.id, "attack");
    assert.equal(calls, 1);
    assert.equal(adapter.calls.length, 0);
    assert.equal(usage[0]?.inputTokens, 100);
    assert.equal(usage[0]?.outputTokens, 20);
    assert.equal(usage[0]?.measurement, "provider");
  } finally {
    await sdk.stop();
  }
});
