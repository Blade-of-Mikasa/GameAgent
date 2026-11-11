import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../src/sdk/state.js";
import { observation, snapshot } from "./helpers.js";

test("state versions change only for semantic updates; duplicates and older observations are ignored", () => {
  const store = new StateStore();
  const initial = observation();
  assert.equal(store.apply(initial)?.state.version, 1);
  assert.equal(store.apply(initial), undefined);
  assert.equal(store.apply(observation(0)), undefined);
  const reordered = Object.fromEntries(
    Object.entries(initial.snapshot).reverse(),
  ) as typeof initial.snapshot;
  assert.equal(store.apply(observation(2, reordered))?.changed, false);
  assert.equal(store.get()?.version, 1);
  assert.equal(
    store.apply(observation(3, { ...initial.snapshot, turn: 2 }))?.state
      .version,
    2,
  );
});

test("callers cannot mutate the stored state", () => {
  const store = new StateStore();
  const initial = observation();
  store.apply(initial);
  Object.assign(initial.snapshot.players[0]!, { hp: 0 });
  const copy = store.get()!;
  Object.assign(copy.players[0]!, { hp: 1 });
  assert.equal(store.get()?.players[0]?.hp, 3);
});

test("invalid observations do not advance the sequence or poison state", () => {
  const store = new StateStore();
  const initial = snapshot();
  const bad = {
    ...initial,
    players: [initial.players[0]!, initial.players[0]!],
  };
  assert.throws(() => store.apply(observation(1, bad)), /identity/);
  assert.equal(store.apply(observation(1, initial))?.state.version, 1);
  assert.throws(
    () => store.apply(observation(2, { ...initial, hand: [] })),
    /invisible card/,
  );
  assert.equal(store.get()?.version, 1);
});
