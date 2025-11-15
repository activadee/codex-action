# Pass-through Environment Variables

Codex runs inside a sandboxed subprocess. By default it only sees a minimal set of environment variables, so secrets defined at the job level stay hidden. The `pass-through-env` input lets you opt-in to forwarding *specific* variables that Codex needs (such as `GH_TOKEN` for pushes or deployment keys for publishing artifacts). This guide walks through configuring, auditing, and troubleshooting that flow.

## 1. Decide what to forward

Create a short list of credentials Codex must read. Typical cases include:

- `GH_TOKEN` or fine-grained PATs for pushing commits/tags.
- Cloud release tokens (`SENTRY_AUTH_TOKEN`, `NPM_TOKEN`, `AWS_ACCESS_KEY_ID`, etc.).
- Service principals used by post-processing scripts Codex executes.

Favor narrowly scoped secrets and rotate them frequently. If Codex can accomplish the task without a credential, do **not** forward it.

## 2. Set the env vars at the workflow or step level

Forwarded variables still need to exist in the workflow environment, usually via secrets:

```yaml
jobs:
  codex:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ secrets.GH_DEPLOY_TOKEN }}
      SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

You can scope them to a single step with the `env:` block directly on the `openai/codex-action` step if you prefer to limit their lifetime.

## 3. Allowlist variables with `pass-through-env`

List the names (newline- or comma-separated) under the action input. Codex and any commands it runs receive *only* the variables you include:

```yaml
- name: Run Codex with env passthrough
  uses: openai/codex-action@v1
  with:
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    prompt-file: .github/codex/release.md
    pass-through-env: |
      GH_TOKEN
      SENTRY_AUTH_TOKEN
```

Refer to [`examples/pass-through-env.yml`](../examples/pass-through-env.yml) for a complete release workflow that tags the repo and uploads artifacts using the forwarded secrets.

## 4. Validate and secure the setup

- Prefer `safety-strategy: drop-sudo` (Linux/macOS) or `unprivileged-user` so the forwarded secrets stay compartmentalized.
- Combine with `sandbox: workspace-write` unless you explicitly need broader filesystem access.
- Add observability: enable `ACTIONS_STEP_DEBUG` in a staging repo to confirm Codex sees the variables (they will show up as redacted `***` entries in the logs).
- Document which teams own each secret and how to rotate them. Consider mirroring the allowlist in repository docs or runbooks so reviews stay simple.

## Rotating forwarded secrets

1. Create a new secret in your provider (GitHub, Sentry, etc.).
2. Update the GitHub Actions secret referenced in the `env:` block.
3. Redeploy or re-run the workflow; Codex now receives the rotated value automatically.
4. Delete the old credential at the source.

Because `pass-through-env` references variables by name, no workflow change is needed unless your secret names change.

## Common pitfalls

- **Variable appears empty inside Codex** – double-check the job/step `env` block defines it and that you spelled the name exactly the same in `pass-through-env`.
- **Unintended secrets leaked** – review logs for every name listed. Remove unused entries and prefer separate jobs for unrelated tasks.
- **Need to forward many variables** – consider grouping them by purpose and creating short helper scripts so Codex only needs a single high-level token (e.g., a short-lived GitHub App token) instead of numerous long-lived keys.
- **Switching to subscription auth** – `pass-through-env` works with both `openai-api-key` and `codex-auth-json-b64`. Just ensure the forwarded secrets are still defined on the step.

## Further reading

- [`docs/security.md`](./security.md) covers broader sandboxing and threat-model guidance.
- The README’s “Forwarding environment variables” section summarizes these steps; this doc dives into the full workflow.
