import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { readConfig } from "../src/app/config.js";
import { runSimulation } from "../src/app/main.js";

test("configuration rejects invalid mode, credentials and unsafe timer values", () => {
  assert.equal(readConfig({}).mode, "offline");
  assert.throws(() => readConfig({ GAME_AGENT_MODE: "oops" }), /MODE/);
  assert.throws(() => readConfig({ GAME_AGENT_MODE: "live" }), /API_KEY/);
  for (const value of ["NaN", "-1", "0", "1.5", "2147483648"]) {
    assert.throws(() => readConfig({ GAME_AGENT_BUDGET_MS: value }), /BUDGET/);
  }
});

test("the entry point writes replayable logs and marks offline usage synthetic", async () => {
  const root = mkdtempSync(join(tmpdir(), "game-agent-test-"));
  try {
    const { summary } = await runSimulation({
      ...readConfig({}),
      turns: 2,
      runsDir: root,
    });
    assert.equal(summary.completed, true);
    assert.equal(summary.decisions, 2);
    assert.equal(summary.usageMeasurement, "synthetic");
    const events = readFileSync(
      join(summary.runDirectory, "events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    assert.equal(
      events.filter((event) => event.type === "action_result").length,
      2,
    );
    assert.ok(
      readFileSync(join(summary.runDirectory, "model.jsonl"), "utf8").includes(
        "submit_action",
      ),
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(summary.runDirectory, "summary.json"), "utf8"),
      ),
      summary,
    );
  } finally {
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        target.includes("game-agent-test-"),
    );
    rmSync(target, { recursive: true, force: true });
  }
});
