/** 当前可见的玩家信息；推测信息不放入观测。 */
export interface PlayerState {
  /** 玩家在本局中的唯一 ID，供动作指定目标。 */
  readonly id: string;
  /** 观测到的当前体力值。 */
  readonly hp: number;
  /** 观测到的体力上限。 */
  readonly maxHp: number;
  /** 公开可见的手牌数量，不代表知道这些牌的内容。 */
  readonly handCount: number;
  /** 已公开的身份；身份未揭示时省略，不填入推测。 */
  readonly revealedRole?: string;
}

/** 控制方可见的一张手牌。 */
export interface Card {
  /** 本局中的卡牌实例 ID，同名的不同卡牌也使用不同 ID。 */
  readonly id: string;
  /** 模型可读的卡牌名称，例如“杀”或“闪”。 */
  readonly name: string;
}

/** SDK 整理后的可见局面，不包含对手的隐藏手牌。 */
export interface GameSnapshot {
  /** 当前由 Agent 控制的玩家 ID，必须存在于 players 中。 */
  readonly playerId: string;
  /** 当前回合所属玩家的 ID；响应窗口中不一定是控制方。 */
  readonly activePlayerId: string;
  /** 游戏回合序号，由 SDK 统一为从 1 开始递增。 */
  readonly turn: number;
  /** SDK 提供的阶段标识，例如 play、response 或 finished。 */
  readonly phase: string;
  /** 本局各玩家的可见状态，玩家 ID 在此列表中唯一。 */
  readonly players: readonly PlayerState[];
  /** 控制方当前可见的手牌；不混入其他玩家的隐藏牌。 */
  readonly hand: readonly Card[];
}

/** SDK 枚举的一个完整合法动作，含执行所需的卡牌与目标。 */
export type ActionOption = {
  /** 当前请求内唯一的选项 ID，只能与所属 requestId 一起使用。 */
  readonly id: string;
  /** 模型可读的完整动作说明，例如“用杀攻击玩家 3”。 */
  readonly label: string;
} & (
  | {
      /** 主动出牌或响应出牌；两种动作都必须指定具体卡牌。 */
      readonly kind: "play_card" | "respond";
      /** 要使用的卡牌实例 ID，必须存在于请求局面的 hand 中。 */
      readonly cardId: string;
      /** 完整目标列表，ID 必须存在于 players；无须指定目标的响应使用空数组。 */
      readonly targetIds: readonly string[];
    }
  | {
      /** 放弃当前响应或结束当前出牌窗口，具体含义由 label 说明。 */
      readonly kind: "pass";
    }
);

/** 一次 SDK 观测；重复观察同一局面仍可能产生新的观测。 */
export interface Observation {
  /** 本次观测的唯一 ID，用于请求追溯其依据。 */
  readonly id: string;
  /** 所属对局的唯一 ID，用于隔离不同对局的数据。 */
  readonly gameId: string;
  /** 同一 SDK 会话内严格递增的观测序号，跨对局也不重置。 */
  readonly sequence: number;
  /** 观测时间，Unix 时间戳，单位为毫秒。 */
  readonly observedAt: number;
  /** 本次观测得到的完整可见局面。 */
  readonly snapshot: GameSnapshot;
}

/** 一次需要控制方选择完整游戏动作的请求，由 SDK 创建。 */
export interface DecisionRequest {
  /** 本局中唯一的请求 ID；旧请求失效后，新请求使用新 ID。 */
  readonly id: string;
  /** 所属对局 ID，必须与依据的观测一致。 */
  readonly gameId: string;
  /** 创建请求所依据的 Observation.id，便于回溯局面来源。 */
  readonly observationId: string;
  /** 本局的局面版本；只在局面语义变化时递增，不等同于观测序号。 */
  readonly stateVersion: number;
  /** 请求创建时间，Unix 时间戳，单位为毫秒。 */
  readonly createdAt: number;
  /** 决策截止时间，Unix 毫秒时间戳；当前时间达到该值时请求失效。 */
  readonly deadlineAt: number;
  /** 与 observationId、stateVersion 对应的可见局面快照。 */
  readonly state: GameSnapshot;
  /** 当前可选的完整合法动作，至少一个；选项 ID 在本请求内唯一。 */
  readonly legalActions: readonly [ActionOption, ...ActionOption[]];
}

/** Kernel 返回的选择；App 将其交给 SDK 校验和执行。 */
export interface Action {
  /** 本局中唯一的动作提交 ID；同一逻辑提交重试时保留此 ID。 */
  readonly id: string;
  /** 所属对局 ID，必须与目标请求一致。 */
  readonly gameId: string;
  /** 本次选择对应的 DecisionRequest.id。 */
  readonly requestId: string;
  /** 做出选择时的请求局面版本，SDK 执行前必须确认仍然有效。 */
  readonly stateVersion: number;
  /** 选中的 ActionOption.id；卡牌和目标参数由 SDK 从原请求取回。 */
  readonly optionId: string;
}

/** SDK 对一次动作提交给出的结果，由 App 回传 Kernel。 */
export interface ActionResult {
  /** 所属对局 ID，必须与动作一致。 */
  readonly gameId: string;
  /** 被处理的请求 ID，必须与动作的 requestId 一致。 */
  readonly requestId: string;
  /** 被处理的 Action.id，用于关联提交与结果。 */
  readonly actionId: string;
  /** succeeded：已确认执行；rejected：确认未执行；unknown：已派发但结果未确认。 */
  readonly status: "succeeded" | "rejected" | "unknown";
  /** 对执行确认、拒绝原因或无法确认原因的可读说明。 */
  readonly reason: string;
  /** SDK 产生本结果的时间，Unix 时间戳，单位为毫秒。 */
  readonly completedAt: number;
}

/** SDK 发布的事件，用判别字段 type 区分事件载荷。 */
export type GameEvent = {
  /** SDK 会话内唯一的事件 ID，用于事件追踪和去重。 */
  readonly id: string;
  /** 所属对局 ID，必须与事件载荷中的对局一致。 */
  readonly gameId: string;
  /** 事件发布时间，Unix 时间戳，单位为毫秒。 */
  readonly at: number;
} & (
  | {
      /** 发布一次新的游戏观测。 */
      readonly type: "observation";
      /** 事件携带的观测数据。 */
      readonly observation: Observation;
    }
  | {
      /** 当前出现了需要控制方选择动作的窗口。 */
      readonly type: "decision_requested";
      /** 需要交给 Kernel 决策的请求。 */
      readonly request: DecisionRequest;
    }
  | {
      /** 已发布的请求不再有效，应取消其决策并丢弃迟到选择。 */
      readonly type: "request_invalidated";
      /** 已失效的 DecisionRequest.id。 */
      readonly requestId: string;
      /** 失效原因：局面变化、到达截止时间或主动取消。 */
      readonly reason: "state_changed" | "expired" | "cancelled";
    }
  | {
      /** 一次动作提交已经有执行结果。 */
      readonly type: "action_result";
      /** SDK 对该提交产生的确认、拒绝或未确认结果。 */
      readonly result: ActionResult;
    }
);
