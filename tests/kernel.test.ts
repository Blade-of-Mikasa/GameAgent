import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "../src/contracts/index.js";
import { buildContext, RuleBook } from "../src/kernel/context.js";
import { createKernel, type KernelTrace } from "../src/kernel/index.js";
import { GameMemory } from "../src/kernel/memory.js";
import { PiRuntime } from "../src/kernel/runtime.js";
import { createSubmitActionTool } from "../src/kernel/tools/submit_action.js";
import { createSDK } from "../src/sdk/index.js";
import { ManualAdapter, observation } from "./helpers.js";

test("Pi queries rules and records an Action without executing the SDK", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  const traces: KernelTrace[] = [];
  const memory = new GameMemory();
  const kernel = createKernel({
    memory,
    onTrace: (trace) => traces.push(trace),
  });
  sdk.onEvent((event) => kernel.onEvent(event));
  await sdk.start();
  const request = sdk.getPendingRequests()[0]!;
  const action = await kernel.decide(request);
  assert.equal(action.requestId, request.id);
  assert.equal(action.choice.kind, "play_card");
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(
    traces
      .filter((trace) => trace.type === "tool_start")
      .map((trace) => trace.data.name),
    ["query_rules", "submit_action"],
  );
  const result = await sdk.execute(action);
  kernel.observeResult(result);
  kernel.observeResult(result);
  assert.equal(memory.snapshot(request.gameId).results.length, 1);
  await sdk.stop();
});

test("submit_action rejects fabricated options, duplicate selection and cancelled calls", async () => {
  const sdk = createSDK(new ManualAdapter());
  await sdk.start();
  const request = sdk.getPendingRequests()[0]!;
  let selections = 0;
  const tool = createSubmitActionTool(request, () => {
    selections++;
  });
  await assert.rejects(
    tool.execute("t1", { optionId: "imaginary" }),
    /Unknown legal action/,
  );
  await assert.rejects(
    tool.execute("t2", { optionId: "attack" }, AbortSignal.abort()),
  );
  await tool.execute("t3", { optionId: "attack" });
  await assert.rejects(
    tool.execute("t4", { optionId: "pass" }),
    /already been selected/,
  );
  assert.equal(selections, 1);
  await sdk.stop();
});

test("bounded model context and transcript clearing preserve full game history and beliefs", async () => {
  const sdk = createSDK(new ManualAdapter());
  await sdk.start();
  const request = sdk.getPendingRequests()[0]!;
  const memory = new GameMemory();
  for (let index = 0; index < 30; index++) {
    const obs = observation(index, request.state);
    const event: GameEvent = {
      id: `event-${index}`,
      gameId: request.gameId,
      at: Date.now(),
      type: "observation",
      state: request.state,
      changed: false,
      observation: {
        ...obs,
        facts: [
          {
            id: `fact-${index}`,
            at: Date.now(),
            kind: "attack",
            actorId: "p2",
            targetId: "p1",
          },
        ],
      },
    };
    memory.record(event);
    memory.record(event);
  }
  memory.setIdentityBelief(request.gameId, {
    playerId: "p2",
    role: "rebel",
    confidence: 0.6,
    evidenceFactIds: ["fact-0"],
  });
  memory.setHandBelief(request.gameId, {
    playerId: "p2",
    cardName: "闪",
    confidence: 0.3,
    evidenceFactIds: [],
  });
  const rules = new RuleBook();
  const context = buildContext(request, memory, rules, 5);
  assert.equal(context.history.length, 5);
  assert.equal(context.historySummary.totalFacts, 30);
  assert.equal(context.beliefs.identities[0]?.confidence, 0.6);
  const runtime = new PiRuntime();
  await runtime.decide(request, context, rules);
  assert.ok(runtime.modelMessageCount > 0);
  runtime.clearModelContext();
  assert.equal(runtime.modelMessageCount, 0);
  assert.equal(memory.snapshot(request.gameId).facts.length, 30);
  assert.equal(memory.snapshot("other-game").facts.length, 0);
  assert.equal(memory.snapshot(request.gameId).hands.length, 1);
  await sdk.stop();
});

test("Kernel cancellation prevents returning an action and permits a fresh decision", async () => {
  const sdk = createSDK(new ManualAdapter());
  await sdk.start();
  const request = sdk.getPendingRequests()[0]!;
  let cancelOnce = true;
  const runtime = new PiRuntime({
    onTrace: (trace) => {
      if (cancelOnce && trace.type === "tool_start") {
        cancelOnce = false;
        runtime.cancel(request.id);
      }
    },
  });
  const rules = new RuleBook();
  const context = buildContext(request, new GameMemory(), rules);
  await assert.rejects(runtime.decide(request, context, rules), /cancelled/);
  assert.equal(
    (await runtime.decide(request, context, rules)).requestId,
    request.id,
  );
  await assert.rejects(
    runtime.decide(request, context, rules, AbortSignal.abort()),
  );
  await sdk.stop();
});

test("live mode fails clearly without credentials and never falls back to a fake answer", async () => {
  const sdk = createSDK(new ManualAdapter());
  await sdk.start();
  await assert.rejects(
    createKernel({ mode: "live" }).decide(sdk.getPendingRequests()[0]!),
    /ANTHROPIC_API_KEY/,
  );
  await sdk.stop();
});
