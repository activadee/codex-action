import parseArgsStringToArgv from "string-argv";

export function parseExtraArgs(value: string): Array<string> {
  if (value.length === 0) {
    return [];
  }

  if (!value.startsWith("[")) {
    return parseArgsStringToArgv(value);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid JSON for --extra-args: ${(error as Error).message}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Invalid JSON for --extra-args: expected a JSON array of strings."
    );
  }

  if (!parsed.every((entry) => typeof entry === "string")) {
    throw new Error(
      "Invalid JSON for --extra-args: every array entry must be a string."
    );
  }

  return parsed;
}
