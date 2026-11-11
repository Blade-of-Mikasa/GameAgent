export interface AppConfig {
  mode: "offline" | "live";
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

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = env.GAME_AGENT_MODE ?? "offline";
  if (mode !== "offline" && mode !== "live")
    throw new Error("GAME_AGENT_MODE must be offline or live");
  if (mode === "live" && !env.ANTHROPIC_API_KEY?.trim())
    throw new Error("Live mode requires ANTHROPIC_API_KEY");
  const offlineStrategy = env.GAME_AGENT_STRATEGY ?? "prefer_attack";
  if (offlineStrategy !== "first_legal" && offlineStrategy !== "prefer_attack")
    throw new Error("Unknown GAME_AGENT_STRATEGY");
  return {
    mode,
    model: env.GAME_AGENT_MODEL ?? "claude-sonnet-4-6",
    ...(mode === "live" && env.ANTHROPIC_API_KEY
      ? { apiKey: env.ANTHROPIC_API_KEY }
      : {}),
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
