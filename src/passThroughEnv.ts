const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type ParsedPassThroughEnv = {
  names: Array<string>;
  invalidNames: Array<string>;
};

export function parsePassThroughEnvInput(raw: string): ParsedPassThroughEnv {
  const entries = raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const names: Array<string> = [];
  const invalidNames: Array<string> = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!ENV_VAR_NAME_PATTERN.test(entry)) {
      if (!invalidNames.includes(entry)) {
        invalidNames.push(entry);
      }
      continue;
    }

    if (seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    names.push(entry);
  }

  return { names, invalidNames };
}

export function forwardSelectedEnvVars({
  names,
  sourceEnv,
  targetEnv,
  protectedKeys,
}: {
  names: Array<string>;
  sourceEnv: NodeJS.ProcessEnv;
  targetEnv: NodeJS.ProcessEnv;
  protectedKeys?: ReadonlySet<string>;
}): {
  forwarded: Array<string>;
  missing: Array<string>;
} {
  const forwarded: Array<string> = [];
  const missing: Array<string> = [];

  const protectedSet = protectedKeys ?? new Set<string>();

  for (const name of names) {
    if (protectedSet.has(name)) {
      continue;
    }

    const value = sourceEnv[name];
    if (value == null) {
      missing.push(name);
      continue;
    }

    targetEnv[name] = value;
    forwarded.push(name);
  }

  return { forwarded, missing };
}

export { ENV_VAR_NAME_PATTERN };
