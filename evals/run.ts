import { parseArgs } from "node:util";
import { readConfig } from "../src/app/config.js";
import { runSimulation } from "../src/app/main.js";
import { RunLog } from "../src/app/run-log.js";

const { values } = parseArgs({
  options: { games: { type: "string", default: "10" } },
});
const games = Number(values.games);
if (!Number.isSafeInteger(games) || games < 1 || games > 1000)
  throw new Error("--games must be between 1 and 1000");
const log = new RunLog("runs/evals");
const reports = [];
for (const strategy of ["first_legal", "prefer_attack"] as const) {
  const samples = [];
  for (let index = 0; index < games; index++) {
    // Evaluation is explicitly offline, regardless of the caller's credential environment.
    const config = {
      ...readConfig({}),
      offlineStrategy: strategy,
      runsDir: log.directory,
    };
    samples.push(await runSimulation(config));
  }
  const decisions = samples.flatMap((sample) => sample.decisions);
  const usage = samples.flatMap((sample) => sample.usage);
  const report = {
    strategy,
    games,
    completionRate:
      samples.filter((sample) => sample.summary.completed).length / games,
    winRate:
      samples.filter(
        (sample) =>
          sample.summary.completed &&
          sample.summary.winnerId === sample.summary.playerId,
      ).length / games,
    timeoutRate:
      samples.reduce((sum, sample) => sum + sample.summary.timeouts, 0) /
      Math.max(1, decisions.length),
    meanDecisionMs:
      decisions.reduce((sum, decision) => sum + decision.durationMs, 0) /
      Math.max(1, decisions.length),
    inputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
    costUsd: usage.reduce((sum, item) => sum + item.costUsd, 0),
    measurement: "synthetic",
  };
  reports.push(report);
  log.append("decisions", report);
}
log.summary({
  reports,
  note: "Deterministic simulator smoke comparison; synthetic usage is not real model cost or playing strength.",
});
console.table(reports);
console.log(`Evaluation logs: ${log.directory}`);
