import { readFile } from "node:fs/promises";
import { Octokit } from "@octokit/rest";

export type ProgressMode = "start" | "finish";

export type UpdateProgressCommentArgs = {
  mode: ProgressMode;
  useStickyComment: boolean;
  commentId: number | null;
  conclusion: string | null;
  finalMessage: string | null;
};

const MARKER = "<!-- codex-action-progress -->";
const TITLE = "### Codex Action Status";

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...<truncated>`;
}

function parseRepository(): { owner: string; repo: string } | null {
  const repository = (process.env.GITHUB_REPOSITORY ?? "").trim();
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

async function readIssueNumberFromEventPayload(): Promise<number | null> {
  const eventPath = (process.env.GITHUB_EVENT_PATH ?? "").trim();
  if (eventPath.length === 0) {
    return null;
  }

  const raw = await readFile(eventPath, "utf8");
  const payload = JSON.parse(raw) as Record<string, unknown>;

  const issue = payload.issue;
  if (issue != null && typeof issue === "object") {
    const issueNumber = (issue as Record<string, unknown>).number;
    if (typeof issueNumber === "number" && Number.isFinite(issueNumber)) {
      return issueNumber;
    }
  }

  const pullRequest = payload.pull_request;
  if (pullRequest != null && typeof pullRequest === "object") {
    const pullRequestNumber = (pullRequest as Record<string, unknown>).number;
    if (
      typeof pullRequestNumber === "number" &&
      Number.isFinite(pullRequestNumber)
    ) {
      return pullRequestNumber;
    }
  }

  const number = payload.number;
  if (typeof number === "number" && Number.isFinite(number)) {
    return number;
  }

  return null;
}

function buildBody(args: UpdateProgressCommentArgs): string {
  if (args.mode === "start") {
    return [
      MARKER,
      TITLE,
      "",
      "Status: in_progress",
      `Updated: ${new Date().toISOString()}`,
    ].join("\n");
  }

  const conclusion = (args.conclusion ?? "unknown").trim() || "unknown";
  const preview = (args.finalMessage ?? "").trim();

  const lines = [
    MARKER,
    TITLE,
    "",
    `Status: completed (${conclusion})`,
    `Updated: ${new Date().toISOString()}`,
  ];

  if (preview.length > 0) {
    const safe = truncate(preview.replace(/```/g, "``\\`"), 2000);
    lines.push("");
    lines.push("<details><summary>Final message preview</summary>");
    lines.push("");
    lines.push("```text");
    lines.push(safe);
    lines.push("```");
    lines.push("</details>");
  }

  return lines.join("\n");
}

async function findStickyCommentId(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<number | null> {
  const iterator = octokit.paginate.iterator(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  for await (const page of iterator) {
    for (const comment of page.data) {
      if (typeof comment.body === "string" && comment.body.includes(MARKER)) {
        return comment.id;
      }
    }
  }

  return null;
}

export async function updateProgressComment(
  args: UpdateProgressCommentArgs
): Promise<number | null> {
  const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
  if (token.length === 0) {
    console.warn("Skipping progress comment update: no GITHUB_TOKEN/GH_TOKEN available.");
    return null;
  }

  const repository = parseRepository();
  if (repository == null) {
    console.warn("Skipping progress comment update: invalid GITHUB_REPOSITORY.");
    return null;
  }

  const issueNumber = await readIssueNumberFromEventPayload();
  if (issueNumber == null) {
    console.warn("Skipping progress comment update: current event is not issue/PR scoped.");
    return null;
  }

  const baseUrl = (process.env.GITHUB_API_URL ?? "").trim();
  const octokit = new Octokit({
    auth: token,
    ...(baseUrl.length > 0 ? { baseUrl } : {}),
  });

  const body = buildBody(args);

  let targetCommentId = args.commentId;
  if (targetCommentId == null && args.useStickyComment) {
    targetCommentId = await findStickyCommentId(
      octokit,
      repository.owner,
      repository.repo,
      issueNumber
    );
  }

  if (targetCommentId != null) {
    await octokit.issues.updateComment({
      owner: repository.owner,
      repo: repository.repo,
      comment_id: targetCommentId,
      body,
    });
    return targetCommentId;
  }

  const created = await octokit.issues.createComment({
    owner: repository.owner,
    repo: repository.repo,
    issue_number: issueNumber,
    body,
  });
  return created.data.id;
}
