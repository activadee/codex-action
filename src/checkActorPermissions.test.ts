import test from "node:test";
import assert from "node:assert/strict";

import { ensureActorHasWriteAccess } from "./checkActorPermissions";

test("bot actors are not implicitly allowed by default", async () => {
  const result = await ensureActorHasWriteAccess({
    actor: "dependabot[bot]",
    repository: "owner/repo",
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.match(result.reason, /token is required/i);
  }
});

test("bot actors can be explicitly allowed", async () => {
  const result = await ensureActorHasWriteAccess({
    actor: "dependabot[bot]",
    repository: "owner/repo",
    allowBotActors: true,
  });

  assert.equal(result.status, "approved");
});
