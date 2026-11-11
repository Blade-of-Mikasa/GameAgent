import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionReceipt } from "../src/sdk/adapters/index.js";
import { createSDK } from "../src/sdk/index.js";
import { actionFor, deferred, ManualAdapter, observation } from "./helpers.js";

test("concurrent retries of the same action dispatch once and return the same confirmation", async () => {
  const adapter = new ManualAdapter();
  const gate = deferred<ExecutionReceipt>();
  adapter.behavior = () => gate.promise;
  const sdk = createSDK(adapter);
  await sdk.start();
  const action = actionFor(sdk.getPendingRequests()[0]!);
  const first = sdk.execute(action);
  const retry = sdk.execute(action);
  await Promise.resolve();
  assert.equal(adapter.calls.length, 1);
  gate.resolve({ actionId: action.id, confirmed: true, message: "Confirmed" });
  assert.deepEqual(await retry, await first);
  assert.equal((await first).status, "succeeded");
  assert.equal(
    (await sdk.execute({ ...action, id: "another-action" })).code,
    "request_unavailable",
  );
  assert.equal(
    (await sdk.execute({ ...action, stateVersion: 999 })).code,
    "action_id_conflict",
  );
  assert.equal(adapter.calls.length, 1);
  await sdk.stop();
});

test("illegal choices, changed states and cancelled commands never reach the adapter", async () => {
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter);
  await sdk.start();
  const action = actionFor(sdk.getPendingRequests()[0]!);
  assert.equal(
    (await sdk.execute({ ...action, id: "wrong-version", stateVersion: 99 }))
      .code,
    "stale_state",
  );
  assert.equal(
    (
      await sdk.execute({
        ...action,
        id: "wrong-target",
        choice: { ...action.choice, targetIds: ["p1"] },
      })
    ).code,
    "illegal_action",
  );
  assert.equal(
    (await sdk.execute({ ...action, id: "cancelled" }, AbortSignal.abort()))
      .code,
    "cancelled",
  );
  adapter.push(observation(2, { ...adapter.initial.snapshot, turn: 2 }));
  assert.equal((await sdk.execute(action)).code, "request_unavailable");
  assert.equal(adapter.calls.length, 0);
  await sdk.stop();
});

test("execution checks the deadline immediately before dispatch", async () => {
  let now = Date.now();
  const adapter = new ManualAdapter();
  const sdk = createSDK(adapter, { now: () => now });
  await sdk.start();
  const request = sdk.getPendingRequests()[0]!;
  now = request.deadlineAt;
  assert.equal((await sdk.execute(actionFor(request))).code, "expired");
  assert.equal(adapter.calls.length, 0);
  await sdk.stop();
});

test("missing or mismatched acknowledgements are unknown, never reported as success", async () => {
  for (const confirmed of [false, true]) {
    const adapter = new ManualAdapter();
    adapter.behavior = async () => ({
      actionId: "wrong-id",
      confirmed,
      message: "Unrelated acknowledgement",
    });
    const sdk = createSDK(adapter);
    await sdk.start();
    const result = await sdk.execute(actionFor(sdk.getPendingRequests()[0]!));
    assert.equal(result.status, "unknown");
    assert.equal(result.code, "unconfirmed");
    await sdk.stop();
  }
});

test("confirmation timeout is bounded even if an adapter ignores cancellation, and retries are suppressed", async () => {
  const adapter = new ManualAdapter();
  adapter.behavior = () => new Promise(() => {});
  const sdk = createSDK(adapter, { confirmationTimeoutMs: 15 });
  await sdk.start();
  const action = actionFor(sdk.getPendingRequests()[0]!);
  const result = await sdk.execute(action);
  assert.equal(result.status, "unknown");
  assert.equal(result.code, "confirmation_timeout");
  assert.deepEqual(await sdk.execute(action), result);
  assert.equal(adapter.calls.length, 1);
  await sdk.stop();
});

test("stopping cancels in-flight dispatch and blocks later commands", async () => {
  const adapter = new ManualAdapter();
  adapter.behavior = () => new Promise(() => {});
  const sdk = createSDK(adapter);
  await sdk.start();
  const action = actionFor(sdk.getPendingRequests()[0]!);
  const pending = sdk.execute(action);
  await Promise.resolve();
  await sdk.stop();
  assert.equal((await pending).status, "unknown");
  assert.equal(
    (await sdk.execute({ ...action, id: "after-stop" })).code,
    "cancelled",
  );
  assert.equal(adapter.calls.length, 1);
});
