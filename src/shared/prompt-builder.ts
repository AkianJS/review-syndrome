import { WorkItemDetails, ImageAttachment } from "./types.js";

function buildImageSection(images?: ImageAttachment[]): string {
  const withLocalPath = (images ?? []).filter((img) => img.localPath);
  if (withLocalPath.length === 0) return "";

  const list = withLocalPath
    .map((img) => `- \`${img.localPath}\` (${img.filename})`)
    .join("\n");

  return `

## Attached Images

The following screenshots/images from the work item are available. Use the Read tool to view them for additional context:
${list}`;
}

export function buildAgentPrompt(workItem: WorkItemDetails): string {
  const commentsSection =
    workItem.comments.length > 0
      ? workItem.comments.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
      : "  None";

  return `You are ReviewSyndrome Agent, an autonomous bug-fixing assistant.

## Work Item
- **ID**: #${workItem.id}
- **Title**: ${workItem.title}
- **Severity**: ${workItem.severity}
- **Priority**: ${workItem.priority}
- **Description**: ${workItem.description || "Not provided"}
- **Repro Steps**: ${workItem.reproSteps || "Not provided"}
- **System Info**: ${workItem.systemInfo || "Not provided"}
- **Comments**:
${commentsSection}

## Instructions
1. Analyze the work item carefully. Understand what the expected behavior is vs actual behavior.
2. Search the codebase to locate the relevant files and code paths.
3. Identify the root cause of the bug.
4. Implement a minimal, focused fix. Do NOT refactor unrelated code. Do NOT add features.
5. If the bug involves a test failure or can be validated with a test, add or update a test.
6. If you cannot confidently identify or fix the bug, make no changes and explain why.

## Constraints
- Only modify files directly related to the bug fix.
- Follow the existing code style and conventions.
- Do not modify configuration files, CI/CD pipelines, or infrastructure code.
- Do not add new dependencies unless absolutely necessary for the fix.
- Keep changes as small as possible.${buildImageSection(workItem.images)}`;
}

export function buildRetryPrompt(
  workItem: WorkItemDetails,
  ciFailureLog: string
): string {
  const basePrompt = buildAgentPrompt(workItem);

  return `${basePrompt}

## CI Failure Context
The previous fix attempt was pushed but CI/CD checks failed. Below is the CI failure log. You must fix the issues that caused the CI failure while still addressing the original bug.

### CI Failure Log
\`\`\`
${ciFailureLog}
\`\`\`

## Additional Instructions
1. Review the existing changes in the working directory — they are the previous fix attempt.
2. Analyze the CI failure log to understand what went wrong.
3. Fix the issues causing CI failure (test failures, build errors, lint errors, etc.).
4. Ensure your fix still addresses the original bug report above.
5. If the CI failure reveals that the approach was wrong, revise the fix entirely.`;
}
