import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SafetyStrategy } from "./runCodexExec";
import { checkOutput } from "./checkOutput";

const MODEL_PROVIDER = "codex-action-responses-proxy";
const MANAGED_BLOCK_BEGIN = "# BEGIN codex-action managed block";
const MANAGED_BLOCK_END = "# END codex-action managed block";
const LEGACY_COMMENT = "# Added by codex-action.";

export async function writeProxyConfig(
  codexHome: string,
  port: number,
  safetyStrategy: SafetyStrategy
): Promise<void> {
  const configPath = path.join(codexHome, "config.toml");

  let existing = "";
  try {
    existing = await fs.readFile(configPath, "utf8");
  } catch {
    existing = "";
  }

  const output = renderProxyConfig(existing, port);

  if (safetyStrategy === "unprivileged-user") {
    // We know we have already created the CODEX_HOME directory, but it is owned
    // by another user, so we need to use sudo to write the file.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-config"));
    try {
      const tempConfigPath = path.join(tempDir, "config.toml");
      await fs.writeFile(tempConfigPath, output, "utf8");
      await checkOutput(["sudo", "mv", tempConfigPath, configPath]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } else {
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(configPath, output, "utf8");
  }
}

export function renderProxyConfig(existing: string, port: number): string {
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const normalized = normalizeNewlines(existing);

  const strippedManaged = stripManagedBlocks(normalized);
  const strippedLegacy = stripLegacyManagedEntries(strippedManaged);
  const cleaned = compactEmptyLines(strippedLegacy).trim();
  const managed = buildManagedBlock(port);

  const rendered =
    cleaned.length > 0 ? `${cleaned}\n\n${managed}\n` : `${managed}\n`;
  return newline === "\r\n" ? rendered.replace(/\n/g, "\r\n") : rendered;
}

function stripManagedBlocks(content: string): string {
  const escapedBegin = escapeRegExp(MANAGED_BLOCK_BEGIN);
  const escapedEnd = escapeRegExp(MANAGED_BLOCK_END);
  const managedBlockRegex = new RegExp(
    `${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`,
    "g"
  );
  return content.replace(managedBlockRegex, "");
}

function stripLegacyManagedEntries(content: string): string {
  const lines = content.split("\n");
  const result: Array<string> = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^model_provider\s*=/.test(trimmed)) {
      index += 1;
      continue;
    }

    if (trimmed === LEGACY_COMMENT) {
      const next = findNextNonEmptyTrimmed(lines, index + 1);
      if (
        next === `[model_providers.${MODEL_PROVIDER}]` ||
        /^model_provider\s*=/.test(next ?? "")
      ) {
        index += 1;
        continue;
      }
    }

    if (trimmed === `[model_providers.${MODEL_PROVIDER}]`) {
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index].trim();
        if (isTomlTableHeader(candidate)) {
          break;
        }
        index += 1;
      }
      continue;
    }

    result.push(line);
    index += 1;
  }

  return result.join("\n");
}

function findNextNonEmptyTrimmed(
  lines: Array<string>,
  start: number
): string | null {
  for (let index = start; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function isTomlTableHeader(trimmedLine: string): boolean {
  return /^(?:\[\[[^\]]+\]\]|\[[^\]]+\])(?:\s+#.*)?$/.test(trimmedLine);
}

function compactEmptyLines(content: string): string {
  const lines = content.split("\n");
  const compacted: Array<string> = [];
  let emptyCount = 0;

  for (const line of lines) {
    if (line.trim().length === 0) {
      emptyCount += 1;
      if (emptyCount <= 1) {
        compacted.push("");
      }
      continue;
    }

    emptyCount = 0;
    compacted.push(line);
  }

  return compacted.join("\n");
}

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function buildManagedBlock(port: number): string {
  return [
    MANAGED_BLOCK_BEGIN,
    `model_provider = "${MODEL_PROVIDER}"`,
    "",
    `[model_providers.${MODEL_PROVIDER}]`,
    'name = "Codex Action Responses Proxy"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'wire_api = "responses"',
    MANAGED_BLOCK_END,
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
