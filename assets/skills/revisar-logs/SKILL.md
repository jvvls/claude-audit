---
name: revisar-logs
description: Use when the user wants to review Claude's session logs in <project>/.claude/logs/ ("revisar logs", "o que você errou", "promover lição", "/revisar-logs") — lists pending logs, surfaces mistakes and wrong diagnoses, and promotes human-approved lessons.
---

# Revisar logs de sessão

This skill helps a human review what Claude did. The human decides. Your job is to summarize honestly and make the decision easy, not to judge your own work.

Logs live in `<project>/.claude/logs/*.md`, inside each project. There is no central folder: for logs of other projects, ask the user for the project path or search with `find ~ -path '*/.claude/logs/*.md' -not -path '*/node_modules/*'`. Lessons live in `~/.claude/rules/licoes.md` (every project) and `<project>/.claude/rules/licoes.md` (one project).

## Procedure

1. **List pending logs.** Find logs with `revisao: pendente`. Default to the current project's folder; if the user asks for all projects, or names a project, log, date or feature, filter to that. Show a short table: file, project, date, tipo, status, and one line on what happened.

2. **For each log the user wants to review**, read it and present:
   - Discarded hypotheses and how far they got before being discarded (were any stated as fact first?).
   - Rules assumed without confirmation: are any still unconfirmed in the code today?
   - Items under "Correções durante a sessão".
   - Anything that contradicts the project's CLAUDE.md or rule files, even if the log doesn't say so.
   - Cost fields, if filled: compare with earlier logs of the same project.

3. **Propose lessons, don't write them yet.** For each mistake that could plausibly repeat, draft an entry in the lessons format (Regra · Camada · Por quê · Origem) and propose a level: **global** if it would hold in a project unrelated to this one, **project** otherwise. Skip one-off slips. First check whether an existing lesson, CLAUDE.md or rule file already covers it; if so, propose sharpening that entry instead.

4. **Ask the user** which drafts to keep, edit or drop, and confirm each level (`AskUserQuestion`, multiSelect when there are several).

5. **Apply only what was approved:**
   - append each approved lesson to the file of its level, with the next `L<n>` number of that file (create `<project>/.claude/rules/licoes.md` with the same header as the global file if it doesn't exist);
   - set each reviewed log's `revisao:` to `erro-registrado`, `ok` or `descartado`, as the user says;
   - if a lesson is really a general rule for a layer, suggest moving it into the CLAUDE.md or a rule file and removing it from the lessons, only if the user agrees.

6. **Housekeeping (optional, ask first):** offer to delete reviewed logs older than ~60 days.

## Don'ts

- Don't soften or omit your own mistakes to make a log look better.
- Don't add lessons the user didn't approve.
- Don't edit the body of a log during review, apart from the `revisao:` field.
