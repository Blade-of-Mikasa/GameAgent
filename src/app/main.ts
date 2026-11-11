import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createKernel, type DecisionUsage } from "../kernel/index.js";
import { SimulatorAdapter } from "../sdk/adapters/simulator.js";
import { createSDK } from "../sdk/index.js";
import { readConfig, type AppConfig } from "./config.js";
import { GameLoop } from "./game-loop.js";
import { RunLog } from "./run-log.js";

export async function runSimulation(config: AppConfig, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const log = new RunLog(config.runsDir);
  const usage: DecisionUsage[] = [];
  const sdk = createSDK(
    new SimulatorAdapter({
      turns: config.turns,
      windowMs: Math.max(config.decisionBudgetMs + 2000, 30_000),
    }),
  );
  const kernel = createKernel({
    mode: config.mode,
    model: config.model,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    offlineStrategy: config.offlineStrategy,
    onTrace: (trace) => log.append("model", trace),
    onUsage: (entry) => {
      usage.push(entry);
      log.append("decisions", { type: "usage", ...entry });
    },
  });
  const loop = new GameLoop(sdk, kernel, {
    decisionBudgetMs: config.decisionBudgetMs,
    onEvent: (event) => log.append("events", event),
    onDecision: (decision) =>
      log.append("decisions", { type: "decision", ...decision }),
  });
  const abort = () => {
    void loop
      .stop()
      .catch((error: unknown) =>
        log.append("events", { type: "stop_error", message: String(error) }),
      );
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await loop.start();
    await loop.waitForIdle();
    const state = sdk.getState();
    const summary = {
      mode: config.mode,
      strategy: config.offlineStrategy,
      completed: state?.phase === "finished",
      winnerId: state?.winnerId ?? null,
      playerId: state?.playerId ?? null,
      decisions: loop.decisions.length,
      succeeded: loop.decisions.filter((entry) => entry.status === "succeeded")
        .length,
      timeouts: loop.decisions.filter(
        (entry) =>
          entry.status === "timeout" ||
          entry.result?.code === "confirmation_timeout",
      ).length,
      costUsd: usage.reduce((sum, entry) => sum + entry.costUsd, 0),
      usageMeasurement: config.mode === "offline" ? "synthetic" : "provider",
      runDirectory: log.directory,
    };
    log.summary(summary);
    return { summary, decisions: loop.decisions, usage, state };
  } finally {
    signal?.removeEventListener("abort", abort);
    await loop.stop();
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = () => {
    process.exitCode = 130;
    controller.abort(new Error("Interrupted"));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { summary } = await runSimulation(readConfig(), controller.signal);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.completed && !process.exitCode) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = process.exitCode || 1;
  });
}
