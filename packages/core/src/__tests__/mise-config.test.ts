import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";

interface MiseConfig {
  tasks?: Record<
    string,
    {
      env?: Record<string, string>;
    }
  >;
}

describe("mise tasks", () => {
  it("enables environment proxy support before the Node dev runtime starts", () => {
    const configPath = resolve(import.meta.dirname, "../../../../mise.toml");
    const config = parse(readFileSync(configPath, "utf8")) as MiseConfig;

    expect(config.tasks?.["dev-node"]?.env?.NODE_USE_ENV_PROXY).toBe("1");
  });
});
