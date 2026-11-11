import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../src/contracts/index.js";
import { RequestManager } from "../src/sdk/requests.js";
import { snapshot } from "./helpers.js";

test("request deduplication and state changes replace pending requests", () => {
  const manager = new RequestManager();
  const state: GameState = { ...snapshot(), version: 1 };
  const first = manager.reconcile(state).created!;
  assert.equal(manager.reconcile(state).created, undefined);
  const change = manager.reconcile({ ...state, version: 2, turn: 2 });
  assert.equal(change.invalidated[0]?.request.id, first.id);
  assert.equal(change.invalidated[0]?.reason, "state_changed");
  assert.equal(change.created?.stateVersion, 2);
  assert.equal(manager.getPending(first.id), undefined);
});

test("a consumed window never creates another request, even after further state changes", () => {
  const manager = new RequestManager();
  const state = { ...snapshot(), version: 1 };
  const first = manager.reconcile(state).created!;
  assert.equal(manager.claim(first.id), true);
  assert.equal(manager.claim(first.id), false);
  manager.complete(first.id);
  assert.equal(manager.reconcile({ ...state, version: 2 }).created, undefined);
  assert.equal(manager.pending().length, 0);
});

test("expired, opponent and finished windows do not request decisions", () => {
  let now = Date.now();
  const state = { ...snapshot(), version: 1 };
  const manager = new RequestManager(() => now);
  const request = manager.reconcile(state).created!;
  now = request.deadlineAt;
  assert.equal(manager.claim(request.id), false);
  assert.equal(manager.reconcile(state).invalidated[0]?.reason, "timeout");
  assert.equal(manager.pending().length, 0);
  const other = new RequestManager();
  assert.equal(
    other.reconcile({ ...state, window: { ...state.window!, playerId: "p2" } })
      .created,
    undefined,
  );
  assert.equal(
    other.reconcile({ ...state, phase: "finished" }).created,
    undefined,
  );
});

test("closing a window invalidates its request and new games can reuse window IDs", () => {
  const manager = new RequestManager();
  const state = { ...snapshot(), version: 1 };
  const first = manager.reconcile(state).created!;
  const { window: _window, ...noWindow } = state;
  assert.equal(
    manager.reconcile({ ...noWindow, version: 2 }).invalidated[0]?.request.id,
    first.id,
  );
  assert.equal(manager.reconcile({ ...state, version: 3 }).created, undefined);
  assert.equal(
    manager.reconcile({ ...state, gameId: "game-2", version: 4 }).created
      ?.gameId,
    "game-2",
  );
});
