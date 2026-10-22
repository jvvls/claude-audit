// Hook de notificação de desktop (Linux, macOS, Windows).
//
// Uso: claude-notify.mjs stop | input
// - stop: no evento Stop; só notifica quando não há subagents/background tasks
//   ainda em execução, para evitar "tarefa finalizada" falso.
// - input: no evento Notification (o Claude precisa de input).
//
// Só usa a biblioteca padrão do Node. Falha em silêncio se não houver notificador.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TITLE = "Claude Code";

function notify(message: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(TITLE)}`];
  } else if (process.platform === "win32") {
    cmd = "powershell";
    args = [
      "-NoProfile",
      "-Command",
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null;" +
        "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
        "$t = $x.GetElementsByTagName('text');" +
        `$t.Item(0).AppendChild($x.CreateTextNode('${TITLE}')) | Out-Null;` +
        `$t.Item(1).AppendChild($x.CreateTextNode('${message}')) | Out-Null;` +
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TITLE}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
    ];
  } else {
    cmd = "notify-send";
    args = [TITLE, message];
  }
  spawnSync(cmd, args, { stdio: "ignore" });
}

function main(): void {
  const mode = process.argv[2] ?? "stop";
  let data: any = {};
  try {
    data = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // sem stdin válido: segue com objeto vazio
  }
  if (mode === "input") {
    notify("Precisa do seu input");
    return;
  }
  const tasks: any[] = Array.isArray(data.background_tasks) ? data.background_tasks : [];
  if (!tasks.some((t) => t?.status === "running" || t?.status === "pending")) notify("Tarefa finalizada");
}

try {
  main();
} catch {
  // notificação nunca bloqueia a sessão
}
