import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { detectTrigger, sanitizeGitHubText } from "./triggerDetection";

function withGitHubEnv(
  values: Record<string, string>,
  fn: () => Promise<void>
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  return fn().finally(() => {
    for (const key of Object.keys(values)) {
      const oldValue = previous[key];
      if (oldValue == null) {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  });
}

test("sanitizeGitHubText removes comments and zero-width chars", () => {
  const sanitized = sanitizeGitHubText(
    "Hello<!--hidden-->\u200B world ![alt text](https://example.com/x.png)"
  );

  assert.equal(sanitized, "Hello world ![](https://example.com/x.png)");
});

test("detectTrigger matches trigger phrase from comment body", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trigger-test-"));
  const payloadPath = path.join(tempDir, "event.json");
  try {
    await writeFile(
      payloadPath,
      JSON.stringify({
        action: "created",
        comment: { body: "please run @codex-action now" },
        issue: { number: 42, title: "Need help", body: "" },
      })
    );

    await withGitHubEnv(
      {
        GITHUB_EVENT_PATH: payloadPath,
        GITHUB_EVENT_NAME: "issue_comment",
        GITHUB_REPOSITORY: "openai/codex-action",
        GITHUB_ACTOR: "octocat",
      },
      async () => {
        const result = await detectTrigger({
          triggerPhrase: "@codex-action",
          labelTrigger: "",
          assigneeTrigger: "",
          sanitizeGitHubContext: true,
        });

        assert.equal(result.triggered, true);
        assert.deepEqual(result.matchedBy, ["trigger-phrase"]);
        assert.ok(
          result.derivedPrompt?.includes("Repository: openai/codex-action")
        );
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectTrigger matches label and assignee triggers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trigger-test-"));
  const payloadPath = path.join(tempDir, "event.json");
  try {
    await writeFile(
      payloadPath,
      JSON.stringify({
        action: "labeled",
        label: { name: "codex" },
        assignee: { login: "codex-bot" },
        issue: {
          number: 7,
          title: "Investigate",
          body: "Please triage",
          labels: [{ name: "codex" }],
          assignees: [{ login: "codex-bot" }],
        },
      })
    );

    await withGitHubEnv(
      {
        GITHUB_EVENT_PATH: payloadPath,
        GITHUB_EVENT_NAME: "issues",
        GITHUB_REPOSITORY: "openai/codex-action",
        GITHUB_ACTOR: "octocat",
      },
      async () => {
        const result = await detectTrigger({
          triggerPhrase: "",
          labelTrigger: "codex",
          assigneeTrigger: "@codex-bot",
          sanitizeGitHubContext: true,
        });

        assert.equal(result.triggered, true);
        assert.deepEqual(result.matchedBy.sort(), [
          "assignee-trigger",
          "label-trigger",
        ]);
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectTrigger no-ops when trigger inputs are not configured", async () => {
  const result = await detectTrigger({
    triggerPhrase: "",
    labelTrigger: "",
    assigneeTrigger: "",
    sanitizeGitHubContext: true,
  });

  assert.equal(result.configured, false);
  assert.equal(result.triggered, true);
  assert.equal(result.derivedPrompt, null);
});
