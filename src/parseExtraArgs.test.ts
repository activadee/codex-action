import test from "node:test";
import assert from "node:assert/strict";

import { parseExtraArgs } from "./parseExtraArgs";

test("parseExtraArgs accepts shell-style strings", () => {
  const result = parseExtraArgs('--flag "quoted value"');
  assert.deepEqual(result, ["--flag", "quoted value"]);
});

test("parseExtraArgs accepts JSON array of strings", () => {
  const result = parseExtraArgs('["--flag","value"]');
  assert.deepEqual(result, ["--flag", "value"]);
});

test("parseExtraArgs rejects malformed JSON", () => {
  assert.throws(
    () => parseExtraArgs('["--flag"'),
    /Invalid JSON for --extra-args/
  );
});

test("parseExtraArgs treats non-JSON-array input as shell-like args", () => {
  const result = parseExtraArgs('{"flag":"value"}');
  assert.deepEqual(result, ['{"flag":"value"}']);
});

test("parseExtraArgs rejects non-string JSON entries", () => {
  assert.throws(
    () => parseExtraArgs('["--flag",123]'),
    /every array entry must be a string/
  );
});
