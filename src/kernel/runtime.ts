import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { Action, DecisionRequest } from "../contracts/index.js";
import type { DecisionContext, RuleBook } from "./context.js";
import { createOfflineModel, type OfflineStrategy } from "./offline.js";
import { decisionPrompt } from "./prompts/decision.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { createQueryRulesTool } from "./tools/query_rules.js";
import { createSubmitActionTool } from "./tools/submit_action.js";

export interface KernelTrace {
  type: "model_message" | "tool_start" | "tool_end";
  requestId: string;
  at: number;
  data: Record<string, unknown>;
}

export interface DecisionUsage {
  requestId: string;
  mode: "offline" | "live";
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Offline transport has synthetic usage; live costs come from Pi's provider/catalog. */
  measurement: "synthetic" | "provider";
}

export interface RuntimeOptions {
  mode?: "offline" | "live";
  model?: string;
  apiKey?: string;
  offlineStrategy?: OfflineStrategy;
  onTrace?: (trace: KernelTrace) => void;
  onUsage?: (usage: DecisionUsage) => void;
}

/** Pi model messages and tool traces stay inside this boundary. */
export class PiRuntime {
  private active:
    { id: string; agent: Agent; controller: AbortController } | undefined;
  private messages: AgentMessage[] = [];

  constructor(private readonly options: RuntimeOptions = {}) {}

  cancel(requestId?: string): void {
    if (!requestId || this.active?.id === requestId) {
      const active = this.active;
      this.active = undefined;
      active?.controller.abort(new Error("Decision cancelled"));
      active?.agent.abort();
    }
  }

  clearModelContext(): void {
    this.messages = [];
  }

  async decide(
    request: DecisionRequest,
    context: DecisionContext,
    rules: RuleBook,
    signal?: AbortSignal,
  ): Promise<Action> {
    signal?.throwIfAborted();
    if (this.active) throw new Error("Kernel already has an active decision");
    if (Date.now() >= request.deadlineAt)
      throw new Error("Decision request expired");
    const mode = this.options.mode ?? "offline";
    const transport =
      mode === "offline"
        ? createOfflineModel(
            request,
            this.options.offlineStrategy ?? "prefer_attack",
          )
        : this.liveModel();
    const start = performance.now();
    let selected: Action | undefined;
    const agent = new Agent({
      initialState: {
        model: transport.model,
        systemPrompt: SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: [
          createQueryRulesTool(rules),
          createSubmitActionTool(request, (action) => {
            selected = action;
          }),
        ],
      },
      streamFn: (model, transcript, options) =>
        transport.models.streamSimple(model, transcript, {
          ...options,
          maxTokens: 1024,
        }),
      ...(this.options.apiKey ? { getApiKey: () => this.options.apiKey } : {}),
      toolExecution: "sequential",
      finishTurn: () => (selected ? { action: "end" } : undefined),
    });
    const controller = new AbortController();
    this.active = { id: request.id, agent, controller };
    const abort = () => this.cancel(request.id);
    signal?.addEventListener("abort", abort, { once: true });
    const usage: DecisionUsage = {
      requestId: request.id,
      mode,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      measurement: mode === "offline" ? "synthetic" : "provider",
    };
    agent.subscribe((event) => {
      const base = { requestId: request.id, at: Date.now() };
      if (event.type === "message_end") {
        this.options.onTrace?.({
          ...base,
          type: "model_message",
          data: { role: event.message.role, content: event.message.content },
        });
        if (event.message.role === "assistant") {
          const tokens = event.message.usage;
          usage.inputTokens += tokens.input;
          usage.outputTokens += tokens.output;
          usage.cacheReadTokens += tokens.cacheRead;
          usage.cacheWriteTokens += tokens.cacheWrite;
          usage.costUsd += tokens.cost.total;
        }
      } else if (event.type === "tool_execution_start") {
        this.options.onTrace?.({
          ...base,
          type: "tool_start",
          data: { name: event.toolName, arguments: event.args },
        });
      } else if (event.type === "tool_execution_end") {
        this.options.onTrace?.({
          ...base,
          type: "tool_end",
          data: { name: event.toolName, isError: event.isError },
        });
      }
    });
    try {
      // Each request starts a fresh transcript from durable game memory.
      await agent.prompt(decisionPrompt(context));
      signal?.throwIfAborted();
      controller.signal.throwIfAborted();
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      if (!selected)
        throw new Error("Model ended without submitting a legal action");
      return selected;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.active?.agent === agent) {
        this.messages = [...agent.state.messages];
        this.active = undefined;
      }
      usage.durationMs = performance.now() - start;
      this.options.onUsage?.(usage);
    }
  }

  /** Only runtime transcript storage is affected; GameMemory is owned by Kernel. */
  get modelMessageCount(): number {
    return this.messages.length;
  }

  private liveModel() {
    if (!this.options.apiKey)
      throw new Error("Live mode requires ANTHROPIC_API_KEY");
    const models = createModels();
    models.setProvider(anthropicProvider());
    const id = this.options.model ?? "claude-sonnet-4-6";
    const model = models.getModel("anthropic", id);
    if (!model) throw new Error(`Unknown Anthropic model: ${id}`);
    return { models, model };
  }
}
