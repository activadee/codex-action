import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { renderProxyConfig, writeProxyConfig } from "./writeProxyConfig";

const PROVIDER_TABLE = "[model_providers.codex-action-responses-proxy]";
const MODEL_PROVIDER_LINE = 'model_provider = "codex-action-responses-proxy"';

test("renderProxyConfig strips legacy codex-action blocks and preserves user content", () => {
  const legacy = `# Added by codex-action.
model_provider = "codex-action-responses-proxy"

title = "my config"

# Added by codex-action.
[model_providers.codex-action-responses-proxy]
name = "Codex Action Responses Proxy"
base_url = "http://127.0.0.1:3000/v1"
wire_api = "responses"

[model_providers.custom]
name = "Custom"
base_url = "https://example.com"
wire_api = "responses"
`;

  const rendered = renderProxyConfig(legacy, 4000);
  assert.equal(countMatches(rendered, MODEL_PROVIDER_LINE), 1);
  assert.equal(countMatches(rendered, PROVIDER_TABLE), 1);
  assert.match(rendered, /\[model_providers\.custom\]/);
  assert.doesNotMatch(rendered, /# Added by codex-action\./);
});

test("renderProxyConfig preserves array table sections after legacy proxy blocks", () => {
  const legacy = `[model_providers.codex-action-responses-proxy]
name = "Codex Action Responses Proxy"
base_url = "http://127.0.0.1:3000/v1"
wire_api = "responses"

[[mcp_servers]]
name = "custom-server"
command = "echo"
`;

  const rendered = renderProxyConfig(legacy, 4000);
  assert.match(rendered, /\[\[mcp_servers\]\]/);
  assert.match(rendered, /name = "custom-server"/);
});

test("renderProxyConfig preserves commented table headers after legacy proxy blocks", () => {
  const legacy = `[model_providers.codex-action-responses-proxy]
name = "Codex Action Responses Proxy"
base_url = "http://127.0.0.1:3000/v1"
wire_api = "responses"

[model_providers.custom] # user-defined provider
name = "Custom"
base_url = "https://example.com"
wire_api = "responses"
`;

  const rendered = renderProxyConfig(legacy, 4000);
  assert.match(rendered, /\[model_providers\.custom\] # user-defined provider/);
  assert.match(rendered, /name = "Custom"/);
});

test("writeProxyConfig is idempotent for repeated runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-config-test-"));
  const configPath = path.join(tempDir, "config.toml");

  try {
    await writeProxyConfig(tempDir, 5555, "unsafe");
    const first = await fs.readFile(configPath, "utf8");
    await writeProxyConfig(tempDir, 5555, "unsafe");
    const second = await fs.readFile(configPath, "utf8");

    assert.equal(second, first);
    assert.equal(countMatches(second, MODEL_PROVIDER_LINE), 1);
    assert.equal(countMatches(second, PROVIDER_TABLE), 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function countMatches(input: string, needle: string): number {
  return input.split(needle).length - 1;
}
