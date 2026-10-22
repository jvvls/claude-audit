#!/usr/bin/env python3
"""Stop hook global: se a sessão editou arquivos do projeto e nenhum log em
<projeto>/.claude/logs/ tem "session: <id>", pede ao Claude para escrever o log
antes de encerrar. Ver ~/.claude/rules/auditoria.md.

Só usa a biblioteca padrão do Python. Não dispara:
- em sessões abertas no próprio home;
- em projetos com o arquivo .claude/audit-off;
- quando as únicas edições foram em .claude/ (inclui os próprios logs).
"""
import glob
import json
import os
import re
import sys

EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def norm(path):
    return os.path.realpath(os.path.expanduser(path))


def inside(path, folder):
    return path == folder or path.startswith(folder + os.sep)


def edited_files(transcript_path, root, excluded):
    found = set()
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict) or entry.get("type") != "assistant":
                continue
            content = (entry.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                if block.get("name") not in EDIT_TOOLS:
                    continue
                tool_input = block.get("input") or {}
                raw = tool_input.get("file_path") or tool_input.get("notebook_path")
                if not raw:
                    continue
                path = norm(raw)
                if inside(path, root) and not any(inside(path, ex) for ex in excluded):
                    found.add(path)
    return found


def has_log(logs_dir, session_id):
    pattern = re.compile(r"^session:\s*" + re.escape(session_id) + r"\s*$", re.M)
    for path in glob.glob(os.path.join(logs_dir, "**", "*.md"), recursive=True):
        try:
            with open(path, encoding="utf-8") as f:
                if pattern.search(f.read()):
                    return True
        except OSError:
            continue
    return False


def main():
    data = json.load(sys.stdin)
    # Evita loop: se já estamos continuando por causa deste hook, deixa parar.
    if data.get("stop_hook_active"):
        return
    session_id = data.get("session_id")
    transcript = data.get("transcript_path")
    root_raw = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd")
    if not session_id or not transcript or not root_raw or not os.path.isfile(transcript):
        return

    root = norm(root_raw)
    home = norm("~")
    if root == home:
        return
    if os.path.exists(os.path.join(root, ".claude", "audit-off")):
        return

    logs_dir = os.path.join(root, ".claude", "logs")
    excluded = [os.path.join(root, ".claude"), norm("~/.claude")]
    edits = edited_files(transcript, root, excluded)
    if not edits or has_log(logs_dir, session_id):
        return

    reason = (
        f"Esta sessão editou {len(edits)} arquivo(s) do projeto e ainda não há log de sessão. "
        f"Antes de encerrar, crie ou atualize um log em {logs_dir}/AAAA-MM-DD-<slug>.md "
        f"seguindo {norm('~/.claude/templates/session-log.md')}, com `session: {session_id}` "
        "no frontmatter. Se a tarefa ainda não terminou, registre o estado atual e marque "
        "status: em-andamento."
    )
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # erro não bloqueante: aparece como aviso, a sessão segue
        print(f"check-session-log: {exc}", file=sys.stderr)
        sys.exit(1)
