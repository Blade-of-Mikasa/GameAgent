# 游戏接入

首版实现 `SimulatorAdapter`，通过 `GameAdapter` 输出结构化观测并接收动作。
观测序号在整个 SDK 会话内单调递增；不同游戏也不能倒退。
每个决策窗口使用唯一 ID，窗口已关闭或已执行后不能复用。

后续的 `screenshot.ts` 应负责截图、解析、点击与执行确认，
`protocol.ts` 应负责协议消息解析、发送与确认。
两者都只依赖 SDK 和 contracts，不引用 Kernel 或 Pi。
适配器只能输出玩家可见信息，不能把对手隐藏手牌放入观测。

`execute` 必须尊重 `AbortSignal`，并用相同的 Action ID 返回确认。
取消发生在发送之后不代表游戏动作被撤销；SDK 会返回 `unknown`，
保留窗口已消费状态，等待后续观测，不能自动重试。
