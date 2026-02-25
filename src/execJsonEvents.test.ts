import test from "node:test";
import assert from "node:assert/strict";

import { parseExecJsonEvents } from "./execJsonEvents";

test("parseExecJsonEvents extracts session id and usage", () => {
  const metadata = parseExecJsonEvents([
    '{"type":"thread.started","thread_id":"thread-123"}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":3,"output_tokens":5}}',
  ].join("\n"));

  assert.equal(metadata.sessionId, "thread-123");
  assert.deepEqual(metadata.usage, {
    input_tokens: 10,
    cached_input_tokens: 3,
    output_tokens: 5,
  });
  assert.equal(metadata.malformedLines, 0);
});

test("parseExecJsonEvents tolerates malformed lines", () => {
  const metadata = parseExecJsonEvents([
    "not-json",
    '{"type":"thread.started","thread_id":"thread-abc"}',
    "{",
  ].join("\n"));

  assert.equal(metadata.sessionId, "thread-abc");
  assert.equal(metadata.usage, null);
  assert.equal(metadata.malformedLines, 2);
});

test("parseExecJsonEvents ignores invalid usage payload", () => {
  const metadata = parseExecJsonEvents(
    '{"type":"turn.completed","usage":{"input_tokens":"x"}}'
  );

  assert.equal(metadata.sessionId, null);
  assert.equal(metadata.usage, null);
  assert.equal(metadata.malformedLines, 0);
});
