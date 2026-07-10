# Remove Claude Empty Tools Argument Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `--tools ""` from every configured and documented Claude invocation so the command no longer passes an explicit empty tools value.

**Architecture:** Keep the existing shell-based Claude invocation and change only its argument string. Synchronize the exact command across the runtime JSON configuration, the scheduler fallback, its exact-value regression test, and README examples.

**Tech Stack:** Node.js CommonJS, Node test runner, JSON, Markdown, POSIX shell

## Global Constraints

- Remove only `--tools ""` from the Claude invocation.
- Keep all other Claude flags, prompt interpolation, shell quoting, JSON output handling, and the `jq` pipeline unchanged.
- Update `commands.json`, `lib/scheduler.js`, `test/scheduler.test.js`, and `README.md` together.
- Leave no configured or documented `--tools ""` occurrence in the repository.

---

### Task 1: Synchronize the Claude command

**Files:**
- Modify: `test/scheduler.test.js:58`
- Modify: `lib/scheduler.js:41`
- Modify: `commands.json:39`
- Modify: `README.md:7`
- Modify: `README.md:76`

**Interfaces:**
- Consumes: `DEFAULT_COMMANDS` exported from `lib/scheduler.js`.
- Produces: A Claude shell command whose flags begin `claude -p --bare --disable-slash-commands` and whose remaining behavior is unchanged.

- [ ] **Step 1: Change the regression expectation**

In `test/scheduler.test.js`, replace the Claude command expectation with:

```js
'claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq \'{result, usage}\'',
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/scheduler.test.js
```

Expected: FAIL in `default commands match the requested codex and claude invocations` because the actual fallback command still contains `--tools ""`.

- [ ] **Step 3: Update the fallback and runtime commands**

In `lib/scheduler.js`, set the Claude command to:

```js
'claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq \'{result, usage}\'',
```

In `commands.json`, set the Claude shell argument to:

```json
"claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt \"\" --output-format json \"{{arithmeticPrompt}}\" | jq '{result, usage}'"
```

- [ ] **Step 4: Update both README examples**

Use this shell example:

```bash
claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq '{result, usage}'
```

Use this JSON argument example:

```json
"args": ["-c", "claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt \"\" --output-format json \"{{arithmeticPrompt}}\" | jq '{result, usage}'"]
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
node --test test/scheduler.test.js
```

Expected: all scheduler tests pass.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm test
rg -n --fixed-strings -- '--tools ""' commands.json lib test README.md
git diff --check
```

Expected: `npm test` exits 0; `rg` exits 1 with no matches; `git diff --check` exits 0 with no output.

- [ ] **Step 7: Commit the implementation**

```bash
git add commands.json lib/scheduler.js test/scheduler.test.js README.md
git commit -m "fix: remove empty claude tools argument"
```
