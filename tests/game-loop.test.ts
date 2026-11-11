import assert from "node:assert/strict";
import test from "node:test";
import type {
  Action,
  ActionResult,
  DecisionRequest,
  GameEvent,
} from "../src/contracts/index.js";
import { GameLoop } from "../src/app/game-loop.js";
import { createKernel, type DecisionKernel } from "../src/kernel/index.js";
import { GameMemory } from "../src/kernel/memory.js";
import { SimulatorAdapter } from "../src/sdk/adapters/simulator.js";
import { createSDK } from "../src/sdk/index.js";
import { actionFor, deferred, ManualAdapter, observation } from "./helpers.js";

function testKernel(decide: DecisionKernel["decide"]) {
  const events: GameEvent[] = [];
  const results: ActionResult[] = [];
  const cancellations: (string | undefined)[] = [];
  return {
    events,
    results,
    cancellations,
    decide,
    onEvent: (event: GameEvent) => {
      events.push(event);
    },
    observeResult: (result: ActionResult) => {
      results.push(result);
    },
    cancel: (id?: string) => {
      cancellations.push(id);
    },
  } satisfies DecisionKernel & {
    events: GameEvent[];
    results: ActionResult[];
    cancellations: (string | undefined)[];
  };
}

test("simulator -> SDK -> Pi -> App -> SDK completes all turns and records results", async () => {
  const adapter = new SimulatorAdapter({ gameId: "integration", turns: 3 });
  const sdk = createSDK(adapter);
  const memory = new GameMemory();
  const loop = new GameLoop(sdk, createKernel({ memory }));
  await loop.start();
  await loop.waitForIdle();
  assert.equal(sdk.getState()?.phase, "finished");
  assert.equal(sdk.getState()?.winnerId, "player-1");
  assert.equal(adapter.executedActions.length, 3);
  assert.equal(
    new Set(adapter.executedActions.map((action) => action.requestId)).size,
    3,
  );
  assert.deepEqual(
    loop.decisions.map((entry) => entry.status),
    ["succeeded", "succeeded", "succeeded"],
  );
  assert.equal(memory.snapshot("integration").facts.length, 3);
  assert.equal(memory.snapshot("integration").results.length, 3);
  assert.equal(sdk.getPendingRequests().length, 0);
  await loop.stop();
});

test("a late action from an invalidated request is discarded while the next request proceeds", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  const first = deferred<Action>();
  const started = deferred<DecisionRequest>();
  let calls = 0;
  const kernel = testKernel(async (request) => {
    if (++calls === 1) {
      started.resolve(request);
      return first.promise;
    }
    return actionFor(request, "fresh-action");
  });
  const loop = new GameLoop(sdk, kernel);
  await loop.start();
  const old = await started.promise;
  adapter.push(observation(2, { ...adapter.initial.snapshot, turn: 2 }));
  await loop.waitForIdle();
  assert.equal(kernel.cancellations[0], old.id);
  assert.deepEqual(
    loop.decisions.map((entry) => entry.status),
    ["cancelled", "succeeded"],
  );
  first.resolve(actionFor(old));
  await first.promise;
  await Promise.resolve();
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.stateVersion, 2);
  await loop.stop();
});

test("a non-cooperative decision is bounded by the budget and invalidates its request", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  const kernel = testKernel(() => new Promise(() => {}));
  const loop = new GameLoop(sdk, kernel, { decisionBudgetMs: 15 });
  await loop.start();
  await loop.waitForIdle();
  assert.equal(loop.decisions[0]?.status, "timeout");
  assert.equal(sdk.getPendingRequests().length, 0);
  assert.equal(adapter.calls.length, 0);
  assert.ok(kernel.cancellations.length > 0);
  await loop.stop();
});

test("a decision that blocks the timer is still rejected after its wall-clock deadline", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  const kernel = testKernel(async (request) => {
    const end = performance.now() + 10;
    while (performance.now() < end) {
      /* Deliberately block the timer callback. */
    }
    return actionFor(request);
  });
  const loop = new GameLoop(sdk, kernel, { decisionBudgetMs: 2 });
  await loop.start();
  await loop.waitForIdle();
  assert.equal(loop.decisions[0]?.status, "timeout");
  assert.equal(adapter.calls.length, 0);
  await loop.stop();
});

test("wrong-request actions fail without dispatch, and later windows can still run", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  let attempts = 0;
  const kernel = testKernel(async (request) =>
    attempts++ === 0
      ? { ...actionFor(request), requestId: "wrong" }
      : actionFor(request, "next"),
  );
  const loop = new GameLoop(sdk, kernel);
  await loop.start();
  await loop.waitForIdle();
  assert.equal(loop.decisions[0]?.status, "failed");
  assert.equal(adapter.calls.length, 0);
  adapter.push(
    observation(2, {
      ...adapter.initial.snapshot,
      window: { ...adapter.initial.snapshot.window!, id: "w2" },
    }),
  );
  await loop.waitForIdle();
  assert.equal(loop.decisions[1]?.status, "succeeded");
  assert.equal(kernel.results.length, 1);
  await loop.stop();
});

test("shutdown cancels a decision, cleans up the adapter and is idempotent", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  const entered = deferred<void>();
  const kernel = testKernel(() => {
    entered.resolve();
    return new Promise(() => {});
  });
  const loop = new GameLoop(sdk, kernel);
  await loop.start();
  await entered.promise;
  await Promise.all([loop.stop(), loop.stop()]);
  assert.equal(loop.decisions[0]?.status, "cancelled");
  assert.equal(adapter.stopped, true);
  assert.equal(adapter.calls.length, 0);
  await assert.rejects(loop.start(), /after stopping/);
});

test("an adapter startup failure cannot dispatch an initial request", async () => {
  const adapter = new ManualAdapter();
  const originalStart = adapter.start.bind(adapter);
  adapter.start = async (emit) => {
    await originalStart(emit);
    throw new Error("startup failed");
  };
  const loop = new GameLoop(
    createSDK(adapter),
    testKernel(async (request) => actionFor(request)),
  );
  await assert.rejects(loop.start(), /startup failed/);
  assert.equal(adapter.calls.length, 0);
  assert.equal(adapter.stopped, true);
});
