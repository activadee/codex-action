# codex-action Changelog

## [Unreleased](https://github.com/openai/codex-action/tree/main)

- set the default `model` input to `gpt-5.3-codex` while preserving opt-out via `model: ""`
- pin the default `codex-version` input to `0.104.0` for deterministic installs
- make proxy liveness checks active (port reachability) and restart when stale server-info is found
- make `write-proxy-config` idempotent with managed blocks and legacy block cleanup
- harden `codex-args` JSON parsing to require an array of strings
- fix unprivileged temp schema cleanup path in `runCodexExec`
- align bot bypass defaults so `allow-bots` defaults to `false` across CLI/action paths
- expand CI to run tests plus workflow linting (`actionlint` + `shellcheck`)

### Migration notes

- This release is additive for `v1.x`: existing workflows that only use `prompt`/`prompt-file` and consume `final-message` continue to work without changes.
- New observability inputs are optional: `capture-json-events`, `json-events-file`, and `write-step-summary`.
- New outputs are now available when needed: `structured-output`, `usage-json`, `execution-file`, `session-id`, `conclusion`, `triggered`, and `tracking-comment-id`.
- Trigger-based execution is opt-in. If you configure any trigger input (`trigger-phrase`, `label-trigger`, or `assignee-trigger`) and no trigger matches, the action exits cleanly with `triggered=false`.
- Progress comments are opt-in (`track-progress`) and require suitable workflow permissions (for example `issues: write` / `pull-requests: write`).
- `structured-output` is only populated when `output-schema` (or `output-schema-file`) is used and the final Codex message is valid JSON.
- No cross-run session resume behavior is introduced in this release (intentional for ephemeral runner compatibility).

## [v1.4](https://github.com/openai/codex-action/tree/v1.4) (2005-11-19)

- [#58](https://github.com/openai/codex-action/pull/58) revert #56 and use the latest stable version of Codex CLI again

## [v1.3](https://github.com/openai/codex-action/tree/v1.3) (2005-11-19)

- [#56](https://github.com/openai/codex-action/pull/56) temporarily set the default version of Codex CLI to `0.58.0`

## [v1.2](https://github.com/openai/codex-action/tree/v1.2) (2005-11-07)

- [#52](https://github.com/openai/codex-action/pull/52) add `baseUrl` to `Octokit` constructor, if appropriate, for GHE

## [v1.1](https://github.com/openai/codex-action/tree/v1.1) (2005-11-05)

- [#47](https://github.com/openai/codex-action/pull/47) added support for Azure via the new `responses-api-endpoint` parameter
- [#36](https://github.com/openai/codex-action/pull/36) added `effort` parameter
- [#45](https://github.com/openai/codex-action/pull/45) pin the commit hash of the `actions/setup-node` action used by `openai/codex-action`

## [v1.0](https://github.com/openai/codex-action/tree/v1.0) (2025-10-06)

- Initial release (OpenAI DevDay 2025!)
