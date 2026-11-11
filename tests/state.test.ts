import assert from "node:assert/strict";
import { test } from "node:test";
import type { Observation } from "../src/contracts/index.js";
import { StateStore } from "../src/sdk/state.ts";

function createObservation(sequence = 1) {
  return {
    id: `obs-${sequence}`,
    gameId: "game-1",
    sequence,
    observedAt: 1_000 + sequence,
    snapshot: {
      playerId: "p1",
      activePlayerId: "p1",
      turn: 1,
      phase: "play",
      players: [
        { id: "p1", hp: 4, maxHp: 4, handCount: 2 },
        { id: "p2", hp: 3, maxHp: 4, handCount: 1 },
      ],
      hand: [
        { id: "slash-1", name: "杀" },
        { id: "dodge-1", name: "闪" },
      ],
    },
  } satisfies Observation;
}

test("无观测时为空，首次观测的局面版本为 1", () => {
  const store = new StateStore();
  const observation = createObservation();
  assert.equal(store.getState(), null);
  assert.equal(store.update(observation), true);
  assert.deepEqual(store.getState(), { observation, stateVersion: 1 });
});

test("局面相同时更新观测信息，版本不变，时钟回退也不影响接收顺序", () => {
  const store = new StateStore();
  store.update(createObservation(10));
  const next = createObservation(12);
  next.observedAt = 900;
  assert.equal(store.update(next), true);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 1 });
});

test("玩家、手牌和阶段变化分别推进版本，随后重复观测保留该版本", () => {
  const store = new StateStore();
  store.update(createObservation());
  const next = createObservation(2);
  next.snapshot.players[1]!.hp -= 1;
  store.update(next);
  assert.equal(store.getState()?.stateVersion, 2);

  next.id = "obs-3";
  next.sequence = 3;
  next.snapshot.hand[0]!.id = "slash-2";
  store.update(next);
  assert.equal(store.getState()?.stateVersion, 3);

  next.id = "obs-4";
  next.sequence = 4;
  next.snapshot.phase = "response";
  store.update(next);
  assert.equal(store.getState()?.stateVersion, 4);

  next.id = "obs-5";
  next.sequence = 5;
  store.update(next);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 4 });
});

test("对象属性的书写顺序不影响局面版本", () => {
  const store = new StateStore();
  store.update(createObservation());
  const next = createObservation(2);
  const { playerId, ...otherFields } = next.snapshot;
  next.snapshot = { ...otherFields, playerId };
  next.snapshot.players = next.snapshot.players.map(({ id, ...player }) => ({
    ...player,
    id,
  }));
  store.update(next);
  assert.equal(store.getState()?.stateVersion, 1);
});

test("玩家和手牌的数组顺序保留，顺序变化会推进局面版本", () => {
  const store = new StateStore();
  store.update(createObservation());
  const next = createObservation(2);
  next.snapshot.players.reverse();
  store.update(next);
  assert.equal(store.getState()?.stateVersion, 2);

  next.id = "obs-3";
  next.sequence = 3;
  next.snapshot.hand.reverse();
  store.update(next);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 3 });
});

test("序号重复或倒退时，即使局面和对局 ID 改变也忽略整个观测", () => {
  const store = new StateStore();
  const current = createObservation(10);
  store.update(current);
  for (const sequence of [10, 9]) {
    const stale = createObservation(sequence);
    stale.gameId = "game-2";
    stale.observedAt = 9_000;
    stale.snapshot.players[0]!.hp = 1;
    assert.equal(store.update(stale), false);
    assert.deepEqual(store.getState(), {
      observation: current,
      stateVersion: 1,
    });
  }
});

test("换局时版本重新从 1 开始，序号继续递增，旧局迟到观测不会切回状态", () => {
  const store = new StateStore();
  store.update(createObservation(10));
  const previous = createObservation(11);
  previous.snapshot.phase = "finished";
  store.update(previous);
  assert.equal(store.getState()?.stateVersion, 2);

  const next = createObservation(12);
  next.gameId = "game-2";
  assert.equal(store.update(next), true);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 1 });
  assert.equal(store.update(previous), false);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 1 });

  next.id = "obs-13";
  next.sequence = 13;
  next.snapshot.turn = 2;
  store.update(next);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 2 });
});

test("输入对象和读取结果的外部修改不能污染内部状态", () => {
  const store = new StateStore();
  const input = createObservation();
  const expected = structuredClone(input);
  store.update(input);
  input.sequence = 100;
  input.snapshot.players[0]!.hp = 0;
  input.snapshot.hand.length = 0;
  assert.deepEqual(store.getState(), {
    observation: expected,
    stateVersion: 1,
  });

  const result = store.getState();
  assert.ok(result);
  // 模拟 JavaScript 调用方绕过 readonly 修改返回对象。
  Reflect.set(result, "stateVersion", 99);
  Reflect.set(result.observation, "sequence", 200);
  Reflect.set(result.observation.snapshot.players[0]!, "hp", 0);
  Reflect.set(result.observation.snapshot.hand, "length", 0);
  assert.deepEqual(store.getState(), {
    observation: expected,
    stateVersion: 1,
  });

  const next = createObservation(2);
  assert.equal(store.update(next), true);
  assert.deepEqual(store.getState(), { observation: next, stateVersion: 1 });
});

test("非法序号不会建立或替换状态，也不会阻止后续合法观测", () => {
  const store = new StateStore();
  for (const sequence of [
    NaN,
    Infinity,
    -Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => store.update(createObservation(sequence)), RangeError);
    assert.equal(store.getState(), null);
  }
  const observation = createObservation(0);
  assert.equal(store.update(observation), true);
  assert.throws(() => store.update(createObservation(NaN)), RangeError);
  assert.deepEqual(store.getState(), { observation, stateVersion: 1 });
});
