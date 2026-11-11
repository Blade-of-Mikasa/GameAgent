# 一次完整动作的交互契约

本模块只定义 SDK、Kernel 和 App 共用的数据类型，没有运行时依赖。
所有字段均在 `index.ts` 中注明含义；时间使用 Unix 毫秒时间戳，
数据使用可序列化的普通对象和数组。`readonly` 提供编译期约束，不会冻结运行时对象。

在仓库根目录执行 `npm ci`、`npm run typecheck` 验证类型定义。

## 一轮交互

1. SDK 发布 `Observation`，整理当前可见局面。
2. 需要控制方选择时，SDK 创建 `DecisionRequest`，列出完整合法动作。
3. App 将请求交给 Kernel，Kernel 返回包含 `optionId` 的 `Action`。
4. App 将动作交给 SDK；SDK 校验后执行选牌、选择目标、确认等操作。
5. SDK 返回 `ActionResult`，App 将其回传 Kernel，再等待下一轮观测。

“用杀攻击玩家 3”是一个完整选项；执行过程中出现新的选择窗口时，再创建请求。
只有观测、无需我方选择时，可以发布观测事件更新记忆，不创建决策请求。

## 数据约束

- `sequence` 标记观测先后；`stateVersion` 标记局面变化。重复观察同一局面
  可以增加观测序号，但不增加状态版本。
- 请求绑定一个局面版本。局面变化、超时或取消后，SDK 发布失效事件，
  App 取消对应决策；迟到的选择不能执行。
- SDK 校验 `gameId`、`requestId`、`stateVersion`、截止时间和 `optionId`，
  从原请求取回卡牌及目标；Kernel 不重新拼装执行参数。
- 同一逻辑提交重试时保留动作 ID；它用于识别重复提交，不表示允许再次操作游戏。
- `succeeded` 表示已确认执行；`rejected` 表示确认未执行；`unknown` 表示
  已派发但结果未确认，不能当作失败自动重试，也不能宣称成功。
- 非空选项列表、出牌必须带卡牌 ID，以及事件与载荷的对应关系由类型约束。
  ID 是否一致、选项是否合法、版本和时间是否有效，仍由后续 SDK 实现运行时校验。

## 完整示例

以下是数据契约示例，不执行游戏或调用模型。示例中的时间为固定演示值。

```ts
import type {
  Action,
  ActionResult,
  DecisionRequest,
  GameEvent,
  Observation,
} from "./index.js";

const observation: Observation = {
  id: "obs-15",
  gameId: "game-1",
  sequence: 15,
  observedAt: 1_800_000_000_000,
  snapshot: {
    playerId: "p1",
    activePlayerId: "p1",
    turn: 2,
    phase: "play",
    players: [
      { id: "p1", hp: 3, maxHp: 4, handCount: 1 },
      { id: "p3", hp: 2, maxHp: 4, handCount: 2 },
    ],
    hand: [{ id: "slash-7", name: "杀" }],
  },
};

const request: DecisionRequest = {
  id: "req-12",
  gameId: observation.gameId,
  observationId: observation.id,
  stateVersion: 12,
  createdAt: observation.observedAt,
  deadlineAt: observation.observedAt + 10_000,
  state: observation.snapshot,
  legalActions: [
    {
      id: "attack-p3",
      label: "用杀攻击玩家 3",
      kind: "play_card",
      cardId: "slash-7",
      targetIds: ["p3"],
    },
    { id: "end-play", label: "结束出牌", kind: "pass" },
  ],
};

const action: Action = {
  id: "action-1",
  gameId: request.gameId,
  requestId: request.id,
  stateVersion: request.stateVersion,
  optionId: "attack-p3",
};

const result: ActionResult = {
  gameId: action.gameId,
  requestId: action.requestId,
  actionId: action.id,
  status: "succeeded",
  reason: "已从游戏确认 slash-7 对 p3 执行成功",
  completedAt: observation.observedAt + 1_000,
};

const completed: GameEvent = {
  id: "event-3",
  gameId: result.gameId,
  at: result.completedAt,
  type: "action_result",
  result,
};
```
