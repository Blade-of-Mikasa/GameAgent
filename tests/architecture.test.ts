import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("source dependencies enforce contracts / SDK / Kernel / App boundaries", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const allowed: Record<string, string[]> = {
    contracts: ["contracts"],
    sdk: ["sdk", "contracts"],
    kernel: ["kernel", "contracts"],
    app: ["app", "sdk", "kernel", "contracts"],
  };
  for (const file of readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts"))) {
    const layer = file.split(sep)[0]!;
    const content = readFileSync(join(root, file), "utf8");
    const imports = [
      ...content.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)["']([^"']+)["']/g,
      ),
    ];
    for (const match of imports) {
      const dependency = match[1]!;
      if (dependency.startsWith(".")) {
        const target = relative(
          root,
          resolve(root, dirname(file), dependency),
        ).split(sep)[0]!;
        assert.ok(
          allowed[layer]?.includes(target) ||
            (layer === "kernel" && dependency.includes("/knowledge/")),
          `${file} may not import ${dependency}`,
        );
      } else {
        assert.notEqual(
          layer,
          "contracts",
          `contracts must not depend on ${dependency}`,
        );
        assert.ok(
          dependency.startsWith("node:") || layer === "kernel",
          `${dependency} must stay inside Kernel`,
        );
      }
    }
  }
});
