# ChatGPT Subscription Auth Guide

Use this walkthrough to run `openai/codex-action` with ChatGPT subscription authentication instead of a platform API key. The high-level flow is:

1. Generate an `auth.json` on a trusted machine with `codex login`.
2. Base64-encode the file and save it as a repository secret (for example `CODEX_AUTH_JSON_B64`).
3. Reference that secret via the action's `codex-auth-json-b64` input in your workflow.

## 1. Generate `auth.json`

1. On a machine where you are already signed in to ChatGPT (or can sign in interactively), install the Codex CLI if needed: `npm install -g @openai/codex`.
2. Run `codex login` and follow the browser-based prompts to authorize Codex with your ChatGPT subscription.
3. When the login completes, verify the CLI created `~/.codex/auth.json`. This file contains your encrypted session and is what the action needs.

> Tip: if you use multiple Codex environments on the same host, you can inspect the contents with `cat ~/.codex/auth.json` to confirm the timestamp before encoding.

## 2. Base64-encode the credentials

Use a command that emits a single-line string without whitespace. Replace `~/.codex/auth.json` if your file lives elsewhere.

```bash
# Linux / GNU base64
base64 -w0 ~/.codex/auth.json

# macOS (BSD base64)
base64 -i ~/.codex/auth.json | tr -d '\n'

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.codex\\auth.json"))
```

Copy the resulting string (no newline) to your clipboard.

## 3. Store the secret in GitHub Actions

1. In your repository, navigate to **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret** and name it `CODEX_AUTH_JSON_B64` (or another name of your choice).
3. Paste the base64 string you captured above. Save the secret.

Consider storing the unencoded `auth.json` in a secure password manager so you can quickly rotate or audit it later.

## 4. Configure a workflow

Reference the secret in the `codex-auth-json-b64` input. The action decodes it and writes it into `CODEX_HOME/auth.json` with permissions `0600`, so Codex runs entirely with subscription auth.

```yaml
name: "Code review with ChatGPT subscription auth"
on:
  pull_request:
    types: [opened]

jobs:
  codex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Run Codex (subscription auth only)
        uses: openai/codex-action@v1
        with:
          codex-auth-json-b64: ${{ secrets.CODEX_AUTH_JSON_B64 }}
          safety-strategy: drop-sudo
          prompt: |
            Review the pull request and summarize blocking issues.
```

See [`examples/code-review-subscription.yml`](../examples/code-review-subscription.yml) for a complete workflow that posts review comments back to GitHub.

## Rotating or revoking credentials

1. On your trusted machine, run `codex logout` to invalidate the previous session (optional but recommended).
2. Run `codex login` again to create a fresh `auth.json`.
3. Re-encode the file, update the GitHub secret with the new base64 string, and save the change.
4. Remove the old secret from password managers or any other storage locations.

If you want to immediately block existing runners, delete the secret in GitHub and push a commit that removes `codex-auth-json-b64` from your workflows. Subsequent jobs will fail fast instead of using stale credentials.

## Common errors and fixes

- **`Failed to parse codex-auth-json-b64`**: The base64 string likely includes whitespace or the wrong file. Re-run the encoding command and ensure there are no newline characters.
- **`auth.json not found`**: Confirm the secret name matches what your workflow references, and that the job injecting the secret actually runs before `openai/codex-action`.
- **`Mixing subscription auth with OPENAI_API_KEY`**: If both `openai-api-key` and `codex-auth-json-b64` are provided, the action prioritizes the Responses API proxy. Remove `openai-api-key` to force subscription auth.
- **`403` / `Unauthorized` responses**: The exported credentials may have expired (they can be invalidated when you log out of ChatGPT or revoke sessions). Generate a fresh `auth.json` and rotate the secret.

Still stuck? Re-run the workflow with `ACTIONS_STEP_DEBUG` enabled to confirm the action detects your secret and writes `auth.json` before Codex starts.
