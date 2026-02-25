export type TurnUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};

export type ExecEventMetadata = {
  sessionId: string | null;
  usage: TurnUsage | null;
  malformedLines: number;
};

function parseUsage(value: unknown): TurnUsage | null {
  if (value == null || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const inputTokens = Number(candidate.input_tokens);
  const cachedInputTokens = Number(candidate.cached_input_tokens);
  const outputTokens = Number(candidate.output_tokens);

  if (
    Number.isFinite(inputTokens) &&
    Number.isFinite(cachedInputTokens) &&
    Number.isFinite(outputTokens)
  ) {
    return {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
    };
  }

  return null;
}

export function parseExecJsonEvents(jsonl: string): ExecEventMetadata {
  let sessionId: string | null = null;
  let usage: TurnUsage | null = null;
  let malformedLines = 0;

  const lines = jsonl.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformedLines += 1;
      continue;
    }

    if (parsed == null || typeof parsed !== "object") {
      continue;
    }

    const event = parsed as Record<string, unknown>;
    const type = event.type;

    if (type === "thread.started") {
      const threadId = event.thread_id;
      if (typeof threadId === "string" && threadId.trim().length > 0) {
        sessionId = threadId;
      }
      continue;
    }

    if (type === "turn.completed") {
      const parsedUsage = parseUsage(event.usage);
      if (parsedUsage != null) {
        usage = parsedUsage;
      }
    }
  }

  return {
    sessionId,
    usage,
    malformedLines,
  };
}
