// PreToolUse hook for Bash and PowerShell. Blocks commands that print resolved environment values
// or the contents of .env into the session. The session log gets committed to a public repo.
// Deny rules in settings.local.json cover the simple cases; this covers what a prefix rule can't
// say, mainly "docker compose config unless it has --quiet or --no-interpolate".
"use strict";

const SAFE_COMPOSE_FLAGS = /(^|\s)(--quiet|-q|--no-interpolate)(\s|$)/;
// Commands that print file contents. Followed by .env (not .env.example) in the same segment.
const READERS =
  /(^|[\s(])(cat|type|head|tail|less|more|bat|nl|strings|sed|awk|grep|rg|findstr|source|Get-Content|gc|Select-String|sls)\b/i;
const DOT_ENV = /(^|[\s"'=\/\\])\.env(\.local)?(?![\w.-])/;

function reasonFor(segment) {
  const s = segment.trim();
  if (/\bdocker(-compose|\s+compose)\b/.test(s)) {
    if (/\sconfig(\s|$)/.test(s) && !SAFE_COMPOSE_FLAGS.test(s)) {
      return "docker compose config prints the resolved environment, .env values included. Use `docker compose config --quiet` or `--no-interpolate`.";
    }
    if (/\s(exec|run)\s.*\b(env|printenv|set)\s*$/.test(s)) {
      return "this prints a container's environment.";
    }
  }
  if (/\bdocker\s+(container\s+)?inspect\b/.test(s)) {
    return "docker inspect prints a container's environment.";
  }
  if (/^(env|printenv|set|export|export\s+-p|declare\s+-x)(\s+-\S+)*$/.test(s) || /^printenv\b/.test(s)) {
    return "this prints the whole environment.";
  }
  if (/\b(Get-ChildItem|gci|dir|ls)\s+env:/i.test(s) || /\[Environment\]::GetEnvironmentVariables/i.test(s)) {
    return "this prints the whole environment.";
  }
  if (READERS.test(s) && DOT_ENV.test(s)) {
    return "this prints the contents of .env.";
  }
  return null;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let command = "";
  try {
    command = String(JSON.parse(input).tool_input?.command ?? "");
  } catch {
    // Not the payload we know how to read: let the normal permission flow decide.
    process.exit(0);
  }
  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    const reason = reasonFor(segment);
    if (reason === null) continue;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Blocked by .claude/hooks/block-env-dump.cjs: ${reason}`,
        },
      }),
    );
    process.exit(0);
  }
  process.exit(0);
});
