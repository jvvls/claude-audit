# Session logs and lessons (every project)

Every task that changes files or diagnoses something leaves a log for human review. Reviewed mistakes become lessons that load in future sessions.

## Logs

- **Where:** `<project>/.claude/logs/AAAA-MM-DD-<slug>.md`, where `<project>` is the folder the session started in. Copy the structure from `~/.claude/templates/session-log.md`. One task = one file; a later session on the same task updates that file and adds its own `session:` line.
- **Session id:** put `session: <id>` in the frontmatter. If you don't know the id, write the log anyway: the Stop hook tells you the id to add.
- **When:** during the task, not only at the end. Hypotheses go in when they appear, discarded ones included. Decisions go in with their source. Record honestly where you were wrong or corrected.
- **Review field:** leave `revisao: pendente`; only a human changes it.
- **Before starting a task,** read the logs in `<project>/.claude/logs/` whose slug matches the feature. Don't read the whole folder.
- A Stop hook blocks the end of a turn when the session edited files in the project and no log carries its session id. It doesn't see edits made through Bash, so the rule above still applies to them. A project opts out with an empty file at `.claude/audit-off`.

## Lessons

- Lessons are rules born from reviewed mistakes. They live in two places:
  - `~/.claude/rules/licoes.md` — applies to every project;
  - `<project>/.claude/rules/licoes.md` — applies to that project only.
- Only a human adds lessons, through `/revisar-logs`. Don't edit these files on your own; propose the lesson in the log's "Correções" section.
- Auto memory holds project *state* (pending decisions, ongoing investigations). Lessons hold *behavior* rules that came from errors.
