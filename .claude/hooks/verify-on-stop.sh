#!/usr/bin/env bash
# Claude Code Stop hook: Claude may not finish a turn until typecheck, lint
# and the unit suite pass. Registered in .claude/settings.json.
#
# - Skips instantly when no file that can affect those checks has changed
#   since the last green run (fingerprint of file contents, not of HEAD, so
#   committing already-verified work does not trigger a re-run).
# - Runs all three steps even if one fails, so a single round surfaces every
#   failure.
# - Blocks at most MAX_ATTEMPTS times in a row per session, then lets Claude
#   stop with a visible warning, so a stuck run cannot loop forever.
# - Escape hatch: CLAUDE_SKIP_VERIFY=1.
set -uo pipefail

MAX_ATTEMPTS=3
TAIL_LINES=40

[[ "${CLAUDE_SKIP_VERIFY:-0}" == "1" ]] && exit 0

input=$(cat)
session=$(jq -r '.session_id // "unknown"' <<<"$input")
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

state_dir="${TMPDIR:-/tmp}/claude-verify-on-stop"
mkdir -p "$state_dir"
key=$(printf '%s' "$PWD" | shasum | cut -c1-12)
pass_file="$state_dir/$key.pass"
attempt_file="$state_dir/$key.$session.attempts"

# Only paths that can change the outcome of check / lint / test.
paths=(src tests scripts drizzle static package.json package-lock.json
  tsconfig.json svelte.config.js vite.config.ts eslint.config.js drizzle.config.ts)

fingerprint=$(git ls-files -z -co --exclude-standard -- "${paths[@]}" |
  xargs -0 shasum 2>/dev/null | shasum | cut -d' ' -f1)

if [[ -f "$pass_file" && "$(cat "$pass_file")" == "$fingerprint" ]]; then
  rm -f "$attempt_file"
  exit 0
fi

failures=""
if [[ ! -d node_modules ]]; then
  failures="node_modules is missing in $PWD. Run \`npm ci\`, then finish again so the checks can run."
else
  run_step() {
    local name=$1 out
    shift
    if ! out=$("$@" 2>&1); then
      failures+=$'\n\n'"### $name failed (\`$*\`)"$'\n'"$(tail -n "$TAIL_LINES" <<<"$out")"
    fi
  }
  run_step "Typecheck" npm run -s check
  run_step "Lint" npm run -s lint
  run_step "Unit tests" npm run -s test
fi

if [[ -z "$failures" ]]; then
  echo "$fingerprint" >"$pass_file"
  rm -f "$attempt_file"
  exit 0
fi

attempts=$(($(cat "$attempt_file" 2>/dev/null || echo 0) + 1))
if ((attempts > MAX_ATTEMPTS)); then
  rm -f "$attempt_file"
  jq -n --arg n "$MAX_ATTEMPTS" '{systemMessage: ("verify-on-stop: checks still failing after " + $n + " fix attempts; stopping so you can take a look.")}'
  exit 0
fi
echo "$attempts" >"$attempt_file"

reason="Verification failed (attempt $attempts/$MAX_ATTEMPTS). Fix the cause, then finish again.
Fix the code, not the tests: do not delete, skip, loosen or rewrite tests to get green. If a test is genuinely wrong, change it and say so explicitly in your summary.$failures"

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
exit 0
