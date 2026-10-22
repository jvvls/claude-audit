#!/usr/bin/env python3
"""Hook de notificação de desktop (Linux, macOS, Windows).

Uso: claude-notify.py stop | input
- stop: no evento Stop; só notifica quando não há subagents/background tasks
  ainda em execução, para evitar "tarefa finalizada" falso.
- input: no evento Notification (o Claude precisa de input).

Só usa a biblioteca padrão do Python. Falha em silêncio se não houver notificador.
"""
import json
import platform
import shutil
import subprocess
import sys

TITLE = "Claude Code"


def notify(message):
    system = platform.system()
    if system == "Darwin":
        script = f"display notification {json.dumps(message)} with title {json.dumps(TITLE)}"
        cmd = ["osascript", "-e", script]
    elif system == "Windows":
        ps = (
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null;"
            "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
            "$t = $x.GetElementsByTagName('text');"
            f"$t.Item(0).AppendChild($x.CreateTextNode('{TITLE}')) | Out-Null;"
            f"$t.Item(1).AppendChild($x.CreateTextNode('{message}')) | Out-Null;"
            "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show([Windows.UI.Notifications.ToastNotification]::new($x))"
        )
        cmd = ["powershell", "-NoProfile", "-Command", ps]
    else:
        cmd = ["notify-send", TITLE, message]
    if shutil.which(cmd[0]):
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "stop"
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}
    if mode == "input":
        notify("Precisa do seu input")
        return
    tasks = data.get("background_tasks") or []
    running = [t for t in tasks if isinstance(t, dict) and t.get("status") in ("running", "pending")]
    if not running:
        notify("Tarefa finalizada")


if __name__ == "__main__":
    try:
        main()
    except Exception:  # notificação nunca bloqueia a sessão
        pass
