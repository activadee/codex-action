import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePassThroughEnvInput,
  forwardSelectedEnvVars,
} from "./passThroughEnv";

test("parsePassThroughEnvInput splits, trims, and deduplicates", () => {
  const { names, invalidNames } = parsePassThroughEnvInput(
    `GH_TOKEN, SENTRY_AUTH_TOKEN\nGH_TOKEN\n9BAD\n_ANOTHER`
  );

  assert.deepEqual(names, ["GH_TOKEN", "SENTRY_AUTH_TOKEN", "_ANOTHER"]);
  assert.deepEqual(invalidNames, ["9BAD"]);
});

test("parsePassThroughEnvInput ignores empty input", () => {
  const { names, invalidNames } = parsePassThroughEnvInput("\n, ,\n");

  assert.deepEqual(names, []);
  assert.deepEqual(invalidNames, []);
});

test("forwardSelectedEnvVars adds values and leaves protected keys alone", () => {
  const targetEnv: NodeJS.ProcessEnv = {
    EXISTING: "keep",
    SENTRY_AUTH_TOKEN: "prefilled",
  };
  const sourceEnv: NodeJS.ProcessEnv = {
    GH_TOKEN: "gh",
    SENTRY_AUTH_TOKEN: "sentry",
  };

  const { forwarded, missing } = forwardSelectedEnvVars({
    names: ["GH_TOKEN", "SENTRY_AUTH_TOKEN", "MISSING_TOKEN"],
    sourceEnv,
    targetEnv,
    protectedKeys: new Set(["EXISTING", "SENTRY_AUTH_TOKEN"]),
  });

  assert.deepEqual(forwarded, ["GH_TOKEN"]);
  assert.deepEqual(missing, ["MISSING_TOKEN"]);
  assert.equal(targetEnv.GH_TOKEN, "gh");
  assert.equal(targetEnv.SENTRY_AUTH_TOKEN, "prefilled");
  assert.equal(targetEnv.EXISTING, "keep");
});

test("forwardSelectedEnvVars tolerates empty config", () => {
  const targetEnv: NodeJS.ProcessEnv = {};
  const sourceEnv: NodeJS.ProcessEnv = {};

  const { forwarded, missing } = forwardSelectedEnvVars({
    names: [],
    sourceEnv,
    targetEnv,
  });

  assert.deepEqual(forwarded, []);
  assert.deepEqual(missing, []);
});
