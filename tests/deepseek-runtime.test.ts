import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/app/config.js";
import {
  createKernel,
  type DecisionUsage,
  type KernelTrace,
} from "../src/kernel/index.js";
import { createSDK } from "../src/sdk/index.js";
import { ManualAdapter } from "./helpers.js";

test("DeepSeek streams rule lookup and action selection using its own environment key", async (t) => {
  let calls = 0;
  const usage: DecisionUsage[] = [];
  const traces: KernelTrace[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(new URL(request.url).origin, "https://api.deepseek.com");
      assert.equal(new URL(request.url).pathname, "/chat/completions");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer fixture-deepseek-key",
      );
      assert.equal(request.headers.get("x-api-key"), null);
      const payload = (await request.json()) as {
        model: string;
        stream: boolean;
        max_tokens: number;
        thinking: { type: string };
        tools: { function: { name: string } }[];
        messages: { role: string; tool_call_id?: string }[];
      };
      assert.equal(payload.model, "deepseek-flash");
      assert.equal(payload.stream, true);
      assert.equal(payload.max_tokens, 1024);
      assert.equal(payload.thinking.type, "disabled");
      assert.ok(
        payload.tools.some((tool) => tool.function.name === "submit_action"),
      );
      assert.ok(
        calls <= 2,
        "Only the two scripted tool turns should be requested",
      );
      if (calls === 2)
        assert.ok(
          payload.messages.some(
            (message) =>
              message.role === "tool" &&
              message.tool_call_id === "fixture-call-1",
          ),
        );
      const name = calls === 1 ? "query_rules" : "submit_action";
      const args = JSON.stringify(
        calls === 1 ? { query: "play" } : { optionId: "attack" },
      );
      const base = {
        id: `fixture-message-${calls}`,
        object: "chat.completion.chunk",
        created: 1,
        model: payload.model,
      };
      const chunks = [
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `fixture-call-${calls}`,
                    type: "function",
                    function: { name, arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: args.slice(0, 8) } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: args.slice(8) } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
        {
          ...base,
          choices: [],
          usage: {
            prompt_tokens: 180,
            completion_tokens: 20,
            total_tokens: 200,
            prompt_cache_hit_tokens: 60,
          },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  );
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  await sdk.start();
  try {
    const config = readConfig(
      {
        DEEPSEEK_API_KEY: "fixture-deepseek-key",
        ANTHROPIC_API_KEY: "unused-anthropic-key",
      },
      { live: true },
    );
    const kernel = createKernel({
      ...config,
      onUsage: (entry) => usage.push(entry),
      onTrace: (entry) => traces.push(entry),
    });
    const action = await kernel.decide(
      sdk.getPendingRequests()[0]!,
      AbortSignal.timeout(3000),
    );
    assert.equal(action.choice.id, "attack");
    assert.equal(calls, 2);
    assert.equal(adapter.calls.length, 0);
    assert.equal(usage[0]?.provider, "deepseek");
    assert.equal(usage[0]?.model, "deepseek-flash");
    assert.equal(usage[0]?.inputTokens, 240);
    assert.equal(usage[0]?.cacheReadTokens, 120);
    assert.equal(usage[0]?.outputTokens, 40);
    assert.equal(usage[0]?.measurement, "provider");
    assert.ok(
      !JSON.stringify({ traces, usage, action }).includes(
        "fixture-deepseek-key",
      ),
    );
  } finally {
    await sdk.stop();
  }
});
