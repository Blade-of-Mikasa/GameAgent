import { MODEL_PROVIDERS, type ModelProvider } from "../kernel/index.js";

export interface AppConfig {
  mode: "offline" | "live";
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  decisionBudgetMs: number;
  runsDir: string;
  turns: number;
  offlineStrategy: "first_legal" | "prefer_attack";
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return number;
}

export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { live?: boolean } = {},
): AppConfig {
  const mode = options.live ? "live" : (env.GAME_AGENT_MODE ?? "offline");
  if (mode !== "offline" && mode !== "live")
    throw new Error("GAME_AGENT_MODE must be offline or live");
  const provider = env.GAME_AGENT_PROVIDER ?? "deepseek";
  if (provider !== "deepseek" && provider !== "anthropic")
    throw new Error("GAME_AGENT_PROVIDER must be deepseek or anthropic");
  const providerConfig = MODEL_PROVIDERS[provider];
  const apiKey = env[providerConfig.apiKeyEnvironmentVariable]?.trim();
  if (mode === "live" && !apiKey)
    throw new Error(
      `Live mode requires ${providerConfig.apiKeyEnvironmentVariable}`,
    );
  const offlineStrategy = env.GAME_AGENT_STRATEGY ?? "prefer_attack";
  if (offlineStrategy !== "first_legal" && offlineStrategy !== "prefer_attack")
    throw new Error("Unknown GAME_AGENT_STRATEGY");
  return {
    mode,
    provider,
    model: env.GAME_AGENT_MODEL ?? providerConfig.defaultModel,
    ...(mode === "live" && apiKey ? { apiKey } : {}),
    decisionBudgetMs: positiveInteger(
      env.GAME_AGENT_BUDGET_MS,
      10_000,
      "GAME_AGENT_BUDGET_MS",
      2_147_483_647,
    ),
    runsDir: env.GAME_AGENT_RUNS_DIR ?? "runs",
    turns: positiveInteger(env.GAME_AGENT_TURNS, 3, "GAME_AGENT_TURNS", 1000),
    offlineStrategy,
  };
}
