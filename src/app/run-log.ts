import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export class RunLog {
  readonly directory: string;

  constructor(root: string) {
    this.directory = resolve(
      root,
      `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
    );
    mkdirSync(this.directory, { recursive: true });
  }

  append(stream: "events" | "decisions" | "model", record: unknown): void {
    appendFileSync(
      join(this.directory, `${stream}.jsonl`),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
  }

  summary(value: unknown): void {
    writeFileSync(
      join(this.directory, "summary.json"),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
}
