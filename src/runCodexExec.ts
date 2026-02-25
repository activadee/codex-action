import { spawn } from "child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { setOutput } from "@actions/core";
import { checkOutput } from "./checkOutput";
import { forwardSelectedEnvVars } from "./passThroughEnv";
import { ExecEventMetadata, TurnUsage, parseExecJsonEvents } from "./execJsonEvents";

export type PromptSource =
  | {
      type: "inline";
      content: string;
    }
  | {
      type: "file";
      path: string;
    };

export type SafetyStrategy =
  | "drop-sudo"
  | "read-only"
  | "unprivileged-user"
  | "unsafe";

export type SandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type OutputSchemaSource =
  | {
      type: "file";
      path: string;
    }
  | {
      type: "inline";
      content: string;
    };

export async function runCodexExec({
  prompt,
  codexHome,
  cd,
  extraArgs,
  explicitOutputFile,
  outputSchema,
  model,
  effort,
  safetyStrategy,
  codexUser,
  sandbox,
  passThroughEnv,
  captureJsonEvents,
  jsonEventsFile,
  writeStepSummary,
}: {
  prompt: PromptSource;
  codexHome: string | null;
  cd: string;
  extraArgs: Array<string>;
  explicitOutputFile: string | null;
  outputSchema: OutputSchemaSource | null;
  model: string | null;
  effort: string | null;
  safetyStrategy: SafetyStrategy;
  codexUser: string | null;
  sandbox: SandboxMode;
  passThroughEnv: Array<string>;
  captureJsonEvents: boolean;
  jsonEventsFile: string | null;
  writeStepSummary: boolean;
}): Promise<void> {
  setOutput("structured-output", "");
  setOutput("session-id", "");
  setOutput("usage-json", "");
  setOutput("execution-file", "");

  let input: string;
  switch (prompt.type) {
    case "inline":
      input = prompt.content;
      break;
    case "file":
      input = await readFile(prompt.path, "utf8");
      break;
  }

  const runAsUser: string | null =
    safetyStrategy === "unprivileged-user" ? codexUser : null;

  let outputFile: OutputFile;
  if (explicitOutputFile != null) {
    outputFile = { type: "explicit", file: explicitOutputFile };
  } else {
    outputFile = await createTempOutputFile({ runAsUser });
  }

  const resolvedOutputSchema = await resolveOutputSchema(
    outputSchema,
    runAsUser
  );
  const shouldCaptureJsonEvents =
    captureJsonEvents || jsonEventsFile != null;
  const resolvedJsonEventsFile = shouldCaptureJsonEvents
    ? await resolveJsonEventsFile(jsonEventsFile)
    : null;
  if (resolvedJsonEventsFile != null) {
    setOutput("execution-file", resolvedJsonEventsFile);
  }
  const sandboxMode = await determineSandboxMode({
    safetyStrategy,
    requestedSandbox: sandbox,
  });

  const command: Array<string> = [];

  let pathToCodex = "codex";
  if (safetyStrategy === "unprivileged-user") {
    if (codexUser == null) {
      throw new Error(
        "codexUser must be specified when using the 'unprivileged-user' safety strategy."
      );
    }

    if (process.platform === "win32") {
      throw new Error(
        "the 'unprivileged-user' safety strategy is not supported on Windows."
      );
    }

    // We are currently running as a privileged user, but `codexUser` will run
    // with a different $PATH variable, so we need to find the full path to
    // `codex`.
    pathToCodex = (await checkOutput(["which", "codex"])).trim();
    if (!pathToCodex) {
      throw new Error("could not find 'codex' in PATH");
    }

    const sudoArgs = ["sudo"];
    if (passThroughEnv.length > 0) {
      sudoArgs.push(`--preserve-env=${passThroughEnv.join(",")}`);
    }
    sudoArgs.push("-u", codexUser, "--");
    command.push(...sudoArgs);
  }

  command.push(
    pathToCodex,
    "exec",
    "--skip-git-repo-check",
    "--cd",
    cd,
    "--output-last-message",
    outputFile.file
  );

  if (resolvedOutputSchema != null) {
    command.push("--output-schema", resolvedOutputSchema.file);
  }

  if (model != null) {
    command.push("--model", model);
  }

  if (effort != null) {
    // https://github.com/openai/codex/blob/00debb6399eb51c4b9273f0bc012912c42fe6c91/docs/config.md#config
    // https://github.com/openai/codex/blob/00debb6399eb51c4b9273f0bc012912c42fe6c91/docs/config.md#model_reasoning_effort
    command.push("--config", `model_reasoning_effort="${effort}"`);
  }

  command.push(...extraArgs);

  if (shouldCaptureJsonEvents) {
    command.push("--json");
  }

  command.push("--sandbox", sandboxMode);

  const env = { ...process.env };
  const protectedEnvKeys = new Set<string>();
  const setEnvAndProtect = (key: string, value: string) => {
    env[key] = value;
    protectedEnvKeys.add(key);
  };

  if (!env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) {
    setEnvAndProtect("CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "codex_github_action");
  }
  let extraEnv = "";
  if (codexHome != null) {
    setEnvAndProtect("CODEX_HOME", codexHome);
    extraEnv = `CODEX_HOME=${codexHome} `;
  }

  // Any env var that we forward here becomes visible to Codex and any commands
  // that it runs, so never log or otherwise expose their values.
  const { forwarded, missing } = forwardSelectedEnvVars({
    names: passThroughEnv,
    sourceEnv: process.env,
    targetEnv: env,
    protectedKeys: protectedEnvKeys,
  });

  if (forwarded.length > 0) {
    console.log(`Forwarding env vars to Codex: ${forwarded.join(", ")}`);
  }
  for (const name of missing) {
    console.log(`Requested env var "${name}" is not set; skipping.`);
  }

  // Split the `program` from the `args` for `spawn()`.
  const program = command.shift()!;
  console.log(
    `Running: ${extraEnv}${program} ${command
      .map((a) => JSON.stringify(a))
      .join(" ")}`
  );
  try {
    await new Promise((resolve, reject) => {
      let stdoutBuffer = "";
      const child = spawn(program, command, {
        env,
        stdio: shouldCaptureJsonEvents
          ? ["pipe", "pipe", "inherit"]
          : ["pipe", "inherit", "inherit"],
      });
      if (child.stdin == null) {
        reject(new Error("Failed to open stdin for codex exec process."));
        return;
      }
      child.stdin.write(input);
      child.stdin.end();

      if (shouldCaptureJsonEvents && child.stdout != null) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdoutBuffer += chunk;
        });
      }

      child.on("error", reject);

      child.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`${program} exited with code ${code}`));
          return;
        }

        try {
          let eventMetadata: ExecEventMetadata | null = null;
          if (shouldCaptureJsonEvents && resolvedJsonEventsFile != null) {
            await writeFile(resolvedJsonEventsFile, stdoutBuffer, "utf8");
            eventMetadata = parseExecJsonEvents(stdoutBuffer);
            if (eventMetadata.malformedLines > 0) {
              console.warn(
                `Ignored ${eventMetadata.malformedLines} malformed JSON event line(s) from codex exec.`
              );
            }
          }

          await finalizeExecution({
            outputFile,
            runAsUser,
            outputSchemaRequested: outputSchema != null,
            eventMetadata,
            writeStepSummary,
            model,
            effort,
            sandboxMode,
            safetyStrategy,
          });
          resolve(undefined);
        } catch (err) {
          reject(err);
        }
      });
    });
  } finally {
    await cleanupOutputSchema(resolvedOutputSchema, runAsUser);
  }
}

async function finalizeExecution(
  {
    outputFile,
    runAsUser,
    outputSchemaRequested,
    eventMetadata,
    writeStepSummary,
    model,
    effort,
    sandboxMode,
    safetyStrategy,
  }: {
    outputFile: OutputFile;
    runAsUser: string | null;
    outputSchemaRequested: boolean;
    eventMetadata: ExecEventMetadata | null;
    writeStepSummary: boolean;
    model: string | null;
    effort: string | null;
    sandboxMode: SandboxMode;
    safetyStrategy: SafetyStrategy;
  }
): Promise<void> {
  try {
    let lastMessage: string;
    if (runAsUser == null) {
      lastMessage = await readFile(outputFile.file, "utf8");
    } else {
      lastMessage = await checkOutput([
        "sudo",
        "-u",
        runAsUser,
        "cat",
        outputFile.file,
      ]);
    }
    setOutput("final-message", lastMessage);

    if (outputSchemaRequested) {
      const structuredOutput = tryParseStructuredOutput(lastMessage);
      if (structuredOutput != null) {
        setOutput("structured-output", JSON.stringify(structuredOutput));
      } else {
        console.warn(
          "Final message is not valid JSON; leaving structured-output empty."
        );
      }
    }

    if (eventMetadata?.sessionId != null) {
      setOutput("session-id", eventMetadata.sessionId);
    }
    if (eventMetadata?.usage != null) {
      setOutput("usage-json", JSON.stringify(eventMetadata.usage));
    }

    if (writeStepSummary) {
      await writeExecutionStepSummary({
        model,
        effort,
        sandboxMode,
        safetyStrategy,
        sessionId: eventMetadata?.sessionId ?? null,
        usage: eventMetadata?.usage ?? null,
        malformedEventLines: eventMetadata?.malformedLines ?? 0,
        finalMessage: lastMessage,
        structuredOutputEnabled: outputSchemaRequested,
      });
    }
  } finally {
    await cleanupTempOutput(outputFile, runAsUser);
  }
}

type OutputFile =
  | {
      type: "explicit";
      file: string;
    }
  | {
      type: "temp";
      file: string;
    };

type ResolvedOutputSchema =
  | {
      type: "explicit";
      file: string;
    }
  | {
      type: "temp";
      file: string;
      dir: string;
    };

async function createTempOutputFile({
  runAsUser,
}: {
  runAsUser: string | null;
}): Promise<OutputFile> {
  const dir = await createTempDir("codex-exec-", runAsUser);
  return { type: "temp", file: path.join(dir, "output.md") };
}

async function cleanupTempOutput(
  outputFile: OutputFile,
  runAsUser: string | null
): Promise<void> {
  switch (outputFile.type) {
    case "explicit":
      // Do not delete user-specified output files.
      return;
    case "temp": {
      const { file } = outputFile;
      if (runAsUser == null) {
        const dir = path.dirname(file);
        await rm(dir, { recursive: true, force: true });
      } else {
        await checkOutput(["sudo", "rm", "-rf", path.dirname(file)]);
      }
      break;
    }
  }
}

async function resolveOutputSchema(
  schema: OutputSchemaSource | null,
  runAsUser: string | null
): Promise<ResolvedOutputSchema | null> {
  if (schema == null) {
    return null;
  }

  switch (schema.type) {
    case "file":
      return { type: "explicit", file: schema.path };
    case "inline": {
      const dir = await createTempDir("codex-output-schema-", runAsUser);
      const file = path.join(dir, "schema.json");
      await writeFile(file, schema.content);
      return { type: "temp", file, dir };
    }
  }
}

async function cleanupOutputSchema(
  schema: ResolvedOutputSchema | null,
  runAsUser: string | null
): Promise<void> {
  if (schema == null) {
    return;
  }

  switch (schema.type) {
    case "explicit":
      return;
    case "temp":
      if (runAsUser == null) {
        await rm(schema.dir, { recursive: true, force: true });
      } else {
        await checkOutput(["sudo", "rm", "-rf", schema.dir]);
      }
      return;
  }
}

async function createTempDir(
  prefix: string,
  runAsUser: string | null
): Promise<string> {
  if (runAsUser == null) {
    return await mkdtemp(path.join(os.tmpdir(), prefix));
  } else {
    return (
      await checkOutput([
        "sudo",
        "-u",
        runAsUser,
        "mktemp",
        "-d",
        "-t",
        `${prefix}.XXXXXX`,
      ])
    ).trim();
  }
}

async function determineSandboxMode({
  safetyStrategy,
  requestedSandbox,
}: {
  safetyStrategy: SafetyStrategy;
  requestedSandbox: SandboxMode;
}): Promise<SandboxMode> {
  if (safetyStrategy === "read-only") {
    return "read-only";
  } else {
    return requestedSandbox;
  }
}

async function resolveJsonEventsFile(
  explicitJsonEventsFile: string | null
): Promise<string> {
  if (explicitJsonEventsFile != null) {
    await mkdir(path.dirname(explicitJsonEventsFile), { recursive: true });
    return explicitJsonEventsFile;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-events-"));
  return path.join(dir, "events.jsonl");
}

function tryParseStructuredOutput(message: string): unknown | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function writeExecutionStepSummary({
  model,
  effort,
  sandboxMode,
  safetyStrategy,
  sessionId,
  usage,
  malformedEventLines,
  finalMessage,
  structuredOutputEnabled,
}: {
  model: string | null;
  effort: string | null;
  sandboxMode: SandboxMode;
  safetyStrategy: SafetyStrategy;
  sessionId: string | null;
  usage: TurnUsage | null;
  malformedEventLines: number;
  finalMessage: string;
  structuredOutputEnabled: boolean;
}): Promise<void> {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile == null || summaryFile.trim().length === 0) {
    return;
  }

  const preview =
    finalMessage.trim().length === 0
      ? "(empty)"
      : truncateForSummary(finalMessage.trim(), 1600);

  const lines = [
    "## Codex Action Run",
    "",
    `- Conclusion: success`,
    `- Model: ${model ?? "(default)"}`,
    `- Effort: ${effort ?? "(default)"}`,
    `- Sandbox: ${sandboxMode}`,
    `- Safety strategy: ${safetyStrategy}`,
    `- Structured output requested: ${structuredOutputEnabled ? "yes" : "no"}`,
    `- Session ID: ${sessionId ?? "(unavailable)"}`,
    `- Usage: ${usage == null ? "(unavailable)" : JSON.stringify(usage)}`,
    `- Malformed JSON event lines ignored: ${malformedEventLines}`,
    "",
    "<details><summary>Final message preview</summary>",
    "",
    "```text",
    preview.replace(/```/g, "``\\`"),
    "```",
    "</details>",
    "",
  ];

  await writeFile(summaryFile, lines.join("\n"), { flag: "a" });
}

function truncateForSummary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...<truncated>`;
}
