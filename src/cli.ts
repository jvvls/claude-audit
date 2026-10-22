#!/usr/bin/env node
// Instalador do claude-audit: copia regras, template, hooks e skill para o
// diretório de configuração do Claude Code e registra os hooks no settings.json.
// Uso: claude-audit-jvvls [install|uninstall] [--yes] [--dir <pasta>]
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const MARK_START = "<!-- claude-audit:start -->";
const MARK_END = "<!-- claude-audit:end -->";
const WIN = process.platform === "win32";
// Nomes dos scripts de hook deste pacote (inclui o antigo, para limpar instalações anteriores).
const HOOK_SCRIPTS = ["check-session-log.py", "claude-notify.py", "claude-stop-notify.sh"];

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const command = args.find((a, i) => !a.startsWith("-") && (dirFlag < 0 || i !== dirFlag + 1)) ?? "install";
const yes = args.includes("--yes") || args.includes("-y");
const claudeDir =
  dirFlag >= 0 ? args[dirFlag + 1] : process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question: string, def: boolean): Promise<boolean> {
  if (yes || !process.stdin.isTTY) return def;
  const answer = (await rl.question(`${question} ${def ? "[S/n]" : "[s/N]"} `)).trim().toLowerCase();
  return answer === "" ? def : ["s", "sim", "y", "yes"].includes(answer);
}

// shell no Windows para resolver npx.cmd, claude.cmd etc.
function run(cmd: string, rest: string[], inherit = false) {
  return spawnSync(cmd, rest, { stdio: inherit ? "inherit" : "ignore", shell: WIN });
}

function has(cmd: string): boolean {
  return run(cmd, ["--version"]).status === 0;
}

// O primeiro interpretador Python 3 que realmente roda (no Windows, "python3" pode ser o atalho da Store).
function findPython(): string | undefined {
  const candidates: [string, string[]][] = WIN
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; sys.exit(sys.version_info[0] != 3)"], {
      stdio: "ignore",
      shell: WIN,
    });
    if (r.status === 0) return [cmd, ...pre].join(" ");
  }
  return undefined;
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
  { src: "hooks/claude-notify.py", dest: "hooks/claude-notify.py", exec: true },
  { src: "skills/revisar-logs/SKILL.md", dest: "skills/revisar-logs/SKILL.md" },
];

const same = (a: string, b: string) => readFileSync(a, "utf8") === readFileSync(b, "utf8");

async function copyFiles(): Promise<void> {
  for (const f of FILES) {
    const src = join(ASSETS, f.src);
    const dest = join(claudeDir, f.dest);
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) {
      if (same(src, dest)) {
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
    if (f.exec && !WIN) chmodSync(dest, 0o755);
    console.log(`  + ${f.dest}`);
  }
}

async function removeFiles(): Promise<void> {
  for (const f of [...FILES, { src: "", dest: "hooks/claude-stop-notify.sh" }]) {
    const dest = join(claudeDir, f.dest);
    if (!existsSync(dest)) continue;
    const pristine = f.src !== "" && same(join(ASSETS, f.src), dest);
    if (!pristine && !(await ask(`  ${f.dest} foi alterado. Remover mesmo assim (com backup)?`, false))) {
      console.log(`  · ${f.dest} mantido`);
      continue;
    }
    if (!pristine) backup(dest);
    rmSync(dest);
    console.log(`  - ${f.dest}`);
  }
}

// Escreve o CLAUDE.md com o bloco claude-audit trocado por `block` ("" remove).
function writeClaudeMd(block: string): void {
  const path = join(claudeDir, "CLAUDE.md");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!current && !block) return;
  const start = current.indexOf(MARK_START);
  const end = current.indexOf(MARK_END);
  let next: string;
  if (start >= 0 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + MARK_END.length);
    if (!block) next = `${next.trimEnd()}\n`;
  } else if (block) {
    next = current ? `${current.trimEnd()}\n\n${block}\n` : `# Instruções Globais\n\n${block}\n`;
  } else {
    return;
  }
  if (next === current) {
    console.log("  = CLAUDE.md (já atualizado)");
    return;
  }
  if (current) backup(path);
  writeFileSync(path, next);
  console.log(block ? "  + CLAUDE.md (bloco claude-audit)" : "  - CLAUDE.md (bloco claude-audit)");
}

type Hook = { type: string; command: string; timeout?: number };
type HookEntry = { matcher?: string; hooks: Hook[] };
type Settings = { hooks?: Record<string, HookEntry[]>; attribution?: Record<string, string>; [k: string]: unknown };

const ours = (h: Hook) => HOOK_SCRIPTS.some((s) => h.command?.includes(s)) || h.command === "notify-send 'Claude Code' 'Precisa do seu input'";

// Remove os hooks deste pacote, mantendo os do usuário.
function stripHooks(settings: Settings): void {
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    const kept = entries
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !ours(h)) }))
      .filter((e) => e.hooks.length > 0);
    if (kept.length) settings.hooks![event] = kept;
    else delete settings.hooks![event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
}

function addHook(settings: Settings, event: string, command: string, timeout?: number): void {
  settings.hooks ??= {};
  (settings.hooks[event] ??= []).push({ hooks: [{ type: "command", command, ...(timeout ? { timeout } : {}) }] });
}

function writeSettings(change: (s: Settings) => void, label: string): void {
  const path = join(claudeDir, "settings.json");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  let settings: Settings = {};
  if (before) {
    try {
      settings = JSON.parse(before);
    } catch {
      console.log("  ! settings.json inválido, não alterado. Ajuste os hooks à mão (ver README).");
      return;
    }
  }
  change(settings);
  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (after === before) {
    console.log("  = settings.json (já atualizado)");
    return;
  }
  if (before) backup(path);
  writeFileSync(path, after);
  console.log(`  ${label}`);
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
      const line = [cmd, ...rest].join(" ");
      if (!has(cmd)) {
        console.log(`  ! '${cmd}' não encontrado; rode à mão: ${line}`);
        break;
      }
      console.log(`  $ ${line}`);
      if (run(cmd, rest, true).status !== 0) {
        console.log(`  ! falhou: ${line}`);
        break;
      }
    }
  }
}

async function install(): Promise<void> {
  const python = findPython();
  if (!python) console.log("  ! Python 3 não encontrado: os hooks não vão rodar até ele ser instalado.\n");
  const py = python ?? (WIN ? "python" : "python3");
  const hook = (name: string) => `${py} "${join(claudeDir, "hooks", name)}"`;

  console.log("Arquivos:");
  await copyFiles();
  writeClaudeMd(`${MARK_START}\n${readFileSync(join(ASSETS, "CLAUDE.md"), "utf8").trim()}\n${MARK_END}`);

  const notify = await ask("\nAtivar notificação de desktop ao terminar e ao pedir input?", false);
  writeSettings((s) => {
    stripHooks(s);
    // Sem trailer Co-Authored-By nos commits.
    s.attribution = { ...s.attribution, commit: "" };
    addHook(s, "Stop", hook("check-session-log.py"), 15);
    if (notify) {
      addHook(s, "Stop", `${hook("claude-notify.py")} stop`, 10);
      addHook(s, "Notification", `${hook("claude-notify.py")} input`, 10);
    }
  }, `+ settings.json (hooks${notify ? " + notificação" : ""})`);

  console.log("\nPlugins recomendados:");
  await installPlugins();

  console.log("\nPronto. Reinicie o Claude Code para carregar regras, hooks e a skill /revisar-logs.");
}

async function uninstall(): Promise<void> {
  console.log("Arquivos:");
  await removeFiles();
  writeClaudeMd("");
  writeSettings(stripHooks, "- settings.json (hooks claude-audit)");
  console.log(
    "\nRemovido. Mantidos: logs dos projetos, attribution.commit no settings.json e backups .bak-*." +
      "\nPlugins (GSD, claude-mem, context-mode) não são removidos por aqui.",
  );
}

async function main(): Promise<void> {
  console.log(`claude-audit ${command} → ${claudeDir}\n`);
  if (command === "install") await install();
  else if (command === "uninstall") await uninstall();
  else {
    console.log("Uso: claude-audit-jvvls [install|uninstall] [--yes] [--dir <pasta>]");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
