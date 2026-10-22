// Stop hook global: se a sessão editou arquivos do projeto e nenhum log em
// <projeto>/.claude/logs/ tem "session: <id>", pede ao Claude para escrever o log
// antes de encerrar. Ver ~/.claude/rules/auditoria.md.
//
// Só usa a biblioteca padrão do Node. Não dispara:
// - em sessões abertas no próprio home;
// - em projetos com o arquivo .claude/audit-off;
// - quando as únicas edições foram em .claude/ (inclui os próprios logs).
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// Este arquivo fica em <claude>/hooks/; o template e a pasta de config vêm daí.
const CLAUDE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// Resolve links pelo ancestral mais próximo que existe: o arquivo editado pode já
// ter sido apagado, e no macOS /var é link para /private/var.
function norm(path: string): string {
  const full = resolve(path.startsWith("~") ? join(homedir(), path.slice(1)) : path);
  try {
    return realpathSync(full);
  } catch {
    const parent = dirname(full);
    return parent === full ? full : join(norm(parent), basename(full));
  }
}

function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

function editedFiles(transcriptPath: string, root: string, excluded: string[]): Set<string> {
  const found = new Set<string>();
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || !EDIT_TOOLS.has(block.name)) continue;
      const raw = block.input?.file_path ?? block.input?.notebook_path;
      if (!raw) continue;
      const path = norm(raw);
      if (inside(path, root) && !excluded.some((ex) => inside(path, ex))) found.add(path);
    }
  }
  return found;
}

function hasLog(logsDir: string, sessionId: string): boolean {
  if (!existsSync(logsDir)) return false;
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^session:\\s*${escaped}\\s*$`, "m");
  for (const name of readdirSync(logsDir, { recursive: true }) as string[]) {
    if (!name.endsWith(".md")) continue;
    try {
      if (pattern.test(readFileSync(join(logsDir, name), "utf8"))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function main(): void {
  const data = JSON.parse(readFileSync(0, "utf8"));
  // Evita loop: se já estamos continuando por causa deste hook, deixa parar.
  if (data.stop_hook_active) return;
  const sessionId: string | undefined = data.session_id;
  const transcript: string | undefined = data.transcript_path;
  const rootRaw: string | undefined = process.env.CLAUDE_PROJECT_DIR || data.cwd;
  if (!sessionId || !transcript || !rootRaw || !existsSync(transcript)) return;

  const root = norm(rootRaw);
  if (root === norm(homedir())) return;
  if (existsSync(join(root, ".claude", "audit-off"))) return;

  const logsDir = join(root, ".claude", "logs");
  const excluded = [join(root, ".claude"), norm(CLAUDE_DIR)];
  const edits = editedFiles(transcript, root, excluded);
  if (edits.size === 0 || hasLog(logsDir, sessionId)) return;

  const reason =
    `Esta sessão editou ${edits.size} arquivo(s) do projeto e ainda não há log de sessão. ` +
    `Antes de encerrar, crie ou atualize um log em ${join(logsDir, "AAAA-MM-DD-<slug>.md")} ` +
    `seguindo ${join(CLAUDE_DIR, "templates", "session-log.md")}, com \`session: ${sessionId}\` ` +
    "no frontmatter. Se a tarefa ainda não terminou, registre o estado atual e marque " +
    "status: em-andamento.";
  console.log(JSON.stringify({ decision: "block", reason }));
}

try {
  main();
} catch (err) {
  // erro não bloqueante: aparece como aviso, a sessão segue
  console.error(`check-session-log: ${err}`);
  process.exitCode = 1;
}
