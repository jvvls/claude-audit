#!/usr/bin/env node
// Instalador do claude-audit: copia regras, template, hooks e skill para o
// diretório de configuração do Claude Code e registra os hooks no settings.json.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const MARK_START = "<!-- claude-audit:start -->";
const MARK_END = "<!-- claude-audit:end -->";

const args = process.argv.slice(2);
const yes = args.includes("--yes") || args.includes("-y");
const dirFlag = args.indexOf("--dir");
const claudeDir =
  dirFlag >= 0 ? args[dirFlag + 1] : process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question: string, def: boolean): Promise<boolean> {
  if (yes || !process.stdin.isTTY) return def;
  const answer = (await rl.question(`${question} ${def ? "[S/n]" : "[s/N]"} `)).trim().toLowerCase();
  return answer === "" ? def : ["s", "sim", "y", "yes"].includes(answer);
}

function has(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
}

function backup(path: string): void {
  copyFileSync(path, `${path}.bak-${stamp}`);
}

// Arquivos copiados. keep: nunca sobrescreve (licoes.md guarda lições do próprio usuário).
const FILES: { src: string; dest: string; exec?: boolean; keep?: boolean }[] = [
  { src: "rules/como-trabalhar.md", dest: "rules/como-trabalhar.md" },
  { src: "rules/auditoria.md", dest: "rules/auditoria.md" },
  { src: "rules/licoes.md", dest: "rules/licoes.md", keep: true },
  { src: "templates/session-log.md", dest: "templates/session-log.md" },
  { src: "hooks/check-session-log.py", dest: "hooks/check-session-log.py", exec: true },
  { src: "hooks/claude-stop-notify.sh", dest: "hooks/claude-stop-notify.sh", exec: true },
  { src: "skills/revisar-logs/SKILL.md", dest: "skills/revisar-logs/SKILL.md" },
];

async function copyFiles(): Promise<void> {
  for (const f of FILES) {
    const src = join(ASSETS, f.src);
    const dest = join(claudeDir, f.dest);
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") === readFileSync(src, "utf8")) {
        console.log(`  = ${f.dest} (já atualizado)`);
        continue;
      }
      if (f.keep) {
        console.log(`  · ${f.dest} já existe, mantido (contém suas lições)`);
        continue;
      }
      if (!(await ask(`  ${f.dest} já existe e é diferente. Sobrescrever (com backup)?`, true))) {
        console.log(`  · ${f.dest} mantido`);
        continue;
      }
      backup(dest);
    }
    copyFileSync(src, dest);
    if (f.exec) chmodSync(dest, 0o755);
    console.log(`  + ${f.dest}`);
  }
}

function installClaudeMd(): void {
  const path = join(claudeDir, "CLAUDE.md");
  const block = `${MARK_START}\n${readFileSync(join(ASSETS, "CLAUDE.md"), "utf8").trim()}\n${MARK_END}`;
  if (!existsSync(path)) {
    writeFileSync(path, `# Instruções Globais\n\n${block}\n`);
    console.log("  + CLAUDE.md");
    return;
  }
  const current = readFileSync(path, "utf8");
  const start = current.indexOf(MARK_START);
  const end = current.indexOf(MARK_END);
  const next =
    start >= 0 && end > start
      ? current.slice(0, start) + block + current.slice(end + MARK_END.length)
      : `${current.trimEnd()}\n\n${block}\n`;
  if (next === current) {
    console.log("  = CLAUDE.md (já atualizado)");
    return;
  }
  backup(path);
  writeFileSync(path, next);
  console.log("  + CLAUDE.md (bloco claude-audit)");
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; attribution?: Record<string, string>; [k: string]: unknown };

function addHook(settings: Settings, event: string, command: string, timeout?: number): void {
  settings.hooks ??= {};
  const entries = (settings.hooks[event] ??= []);
  if (entries.some((e) => e.hooks?.some((h) => h.command === command))) return;
  entries.push({ hooks: [{ type: "command", command, ...(timeout ? { timeout } : {}) }] });
}

function installSettings(notify: boolean): void {
  const path = join(claudeDir, "settings.json");
  let settings: Settings = {};
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (before) {
    try {
      settings = JSON.parse(before);
    } catch {
      console.log("  ! settings.json inválido, não alterado. Registre os hooks à mão (ver README).");
      return;
    }
  }
  // Sem trailer Co-Authored-By nos commits.
  settings.attribution = { ...settings.attribution, commit: "" };
  addHook(settings, "Stop", `python3 "${join(claudeDir, "hooks", "check-session-log.py")}"`, 15);
  if (notify) {
    addHook(settings, "Stop", `bash "${join(claudeDir, "hooks", "claude-stop-notify.sh")}"`);
    addHook(settings, "Notification", "notify-send 'Claude Code' 'Precisa do seu input'");
  }
  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (after === before) {
    console.log("  = settings.json (já atualizado)");
    return;
  }
  if (before) backup(path);
  writeFileSync(path, after);
  console.log(`  + settings.json (hooks${notify ? " + notificação" : ""})`);
}

const PLUGINS: { name: string; why: string; cmds: string[][] }[] = [
  {
    name: "GSD (get-shit-done)",
    why: "fluxo de fases: discuss → plan → execute → verify",
    cmds: [["npx", "get-shit-done-cc@latest", "--claude", "--global"]],
  },
  {
    name: "claude-mem",
    why: "memória persistente entre sessões",
    cmds: [
      ["claude", "plugin", "marketplace", "add", "thedotmack/claude-mem"],
      ["claude", "plugin", "install", "claude-mem@thedotmack"],
    ],
  },
  {
    name: "context-mode",
    why: "mantém saídas grandes fora da janela de contexto",
    cmds: [
      ["claude", "plugin", "marketplace", "add", "mksglu/context-mode"],
      ["claude", "plugin", "install", "context-mode@context-mode"],
    ],
  },
];

async function installPlugins(): Promise<void> {
  for (const p of PLUGINS) {
    if (!(await ask(`Instalar ${p.name} (${p.why})?`, false))) continue;
    for (const [cmd, ...rest] of p.cmds) {
      if (!has(cmd)) {
        console.log(`  ! '${cmd}' não encontrado; rode à mão: ${[cmd, ...rest].join(" ")}`);
        break;
      }
      console.log(`  $ ${[cmd, ...rest].join(" ")}`);
      if (spawnSync(cmd, rest, { stdio: "inherit" }).status !== 0) {
        console.log(`  ! falhou: ${[cmd, ...rest].join(" ")}`);
        break;
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`claude-audit → ${claudeDir}\n`);
  if (!has("python3")) console.log("  ! python3 não encontrado: o hook de log de sessão não vai rodar.\n");

  console.log("Arquivos:");
  await copyFiles();
  installClaudeMd();

  const notify = await ask(
    "\nAtivar notificação de desktop ao terminar e ao pedir input (usa notify-send e jq)?",
    false,
  );
  if (notify && !(has("notify-send") && has("jq"))) console.log("  ! notify-send ou jq ausente: a notificação não vai aparecer.");
  installSettings(notify);

  console.log("\nPlugins recomendados:");
  await installPlugins();

  console.log("\nPronto. Reinicie o Claude Code para carregar regras, hooks e a skill /revisar-logs.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
