# How to work (every project)

## Files

- Open files with the Read tool, not `cat`/`sed`: path-scoped project rules load only on Read/Edit/Write.
- Edit with Edit/Write, never with scripts run through Bash. Script edits skip checkpoints (`/rewind`), path-scoped rules and the session-log hook.

## Scope

Do what was asked plus what it strictly needs. No unrequested UI elements, styling, examples, docs or refactors: propose them in the report instead. Never switch branches or edit files in a repository the task doesn't involve. Before changing shared code, find its callers and name them in the report.

## Asking

- Explore first, then ask **once, in a single batch**, before implementing. Each question lists the options with where each one comes from, plus your recommendation. After that, implement without new questions unless something blocks the work.
- Don't ask about choices the codebase already answers with a clear precedent: decide, and list them in the report.
- If no answer comes, or the user says to proceed, apply your recommendations and mark them **assumed** in the report.
- A reference named in the request wins over general rules in any CLAUDE.md, rule file or skill.

## Verification

- Before editing a repository, run its checks once and record what already fails (baseline). After the change, run the same checks and report new failures separately from pre-existing ones.
- Show evidence, not assertions: the command and its result, the number reproduced, the screenshot.

## Diagnosis

A cause is a hypothesis until reproduced: a failing test, a query, or a script that gives the observed value (for numeric gaps, the exact number). Name one observation that would refute your favorite hypothesis and check it. Trace a symptom back to the layer that owns it. State confidence: confirmed (with evidence) / likely (what's missing) / unknown.

## Report

Every response that changes code ends with: what changed, file by file · patterns followed, and deviations with their reason · each decision with its source (request, docs, existing code, reference, assumed) · validation results, new vs. pre-existing failures · open questions · the session log path.

## Compaction

When compacting, keep: the request, the spec path if any, files changed, decisions with their sources, open questions, baseline results and the session log path.
