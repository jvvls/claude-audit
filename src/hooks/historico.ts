// Histórico de sessões: transforma cada conversa do Claude Code em uma ficha
// (sem modelo, sem custo de tokens) antes que o Claude Code a apague, e serve de
// entrada para a skill /relatorio. Ver skills/relatorio/SKILL.md.
//
// Uso:
//   hook SessionStart/SessionEnd (JSON no stdin) → arquiva; no SessionStart avisa
//     de meses fechados sem relatório (no máximo uma vez por dia)
//   historico.mjs arquivar
//   historico.mjs mes <mês> [ano] [pastas...]   (nov, novembro, 11, 11/2026, 2026-11)
//   historico.mjs buscar <termos...>
//   historico.mjs pendentes
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Este arquivo fica em <claude>/hooks/.
const CLAUDE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECTS = join(CLAUDE_DIR, "projects");
const HIST = join(CLAUDE_DIR, "historico");
const ESTADO = join(HIST, "estado.json");
const MAX_MSG = 2000; // caracteres por mensagem na ficha
const MAX_MSG_DIGEST = 500; // caracteres por mensagem no digest do mês
const MAX_GAP_MS = 10 * 60 * 1000; // pausa maior que isso não conta como tempo ativo
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

type Ficha = {
  session: string;
  titulo: string;
  projeto: string;
  projeto_path: string;
  inicio: string;
  fim: string;
  ativo_min: number;
  mensagens: string[];
  arquivos: string[];
  ferramentas: Record<string, number>;
  erros_ferramenta: number;
  commits: number;
  log: string | null;
  fonte_mtime: number;
};

type Estado = { arquivadas: Record<string, number>; projetos: string[]; ultimo_aviso?: string };

function lerJson<T>(path: string, padrao: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return padrao;
  }
}

function lerEstado(): Estado {
  const e = lerJson<Partial<Estado>>(ESTADO, {});
  return { arquivadas: e.arquivadas ?? {}, projetos: e.projetos ?? [], ultimo_aviso: e.ultimo_aviso };
}

function salvar(path: string, conteudo: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, conteudo);
}

const pad = (n: number) => String(n).padStart(2, "0");
const anoMes = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dia = (d: Date) => `${anoMes(d)}-${pad(d.getDate())}`;

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const HOME = real(homedir());

function nomeProjeto(path: string): string {
  if (!path) return "_sem-projeto";
  if (path === homedir() || real(path) === HOME) return "_home";
  return basename(path) || "_raiz";
}

function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max)} […+${texto.length - max} caracteres]`;
}

// Mensagem digitada pelo usuário, sem avisos de sistema; "" quando não é do usuário.
function limpar(texto: string): string {
  let t = texto.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (/^<(local-command-caveat|local-command-stdout|local-command-stderr|task-notification|bash-stdout|bash-stderr)>/.test(t)) {
    return "";
  }
  const nome = t.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
  if (nome) {
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
    t = `${nome.startsWith("/") ? nome : `/${nome}`} ${args}`.trim();
  }
  return t;
}

function textoDoUsuario(entry: any): string[] {
  if (entry.isMeta || entry.isCompactSummary || entry.isSidechain) return [];
  if (entry.origin && entry.origin.kind !== "human") return [];
  const c = entry.message?.content;
  const partes = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text) : [];
  return partes.map((p) => limpar(String(p ?? ""))).filter(Boolean);
}

function acharLog(projetoPath: string, sessionId: string): string | null {
  const dir = join(projetoPath, ".claude", "logs");
  if (!projetoPath || !existsSync(dir)) return null;
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith(".md")) continue;
    try {
      if (readFileSync(join(dir, nome), "utf8").includes(sessionId)) return join(dir, nome);
    } catch {
      continue;
    }
  }
  return null;
}

export function lerConversa(path: string, sessionId: string): Ficha | null {
  let titulo = "";
  let projetoPath = "";
  const tempos: number[] = [];
  const mensagens: string[] = [];
  const arquivos = new Set<string>();
  const ferramentas: Record<string, number> = {};
  let erros = 0;
  let commits = 0;

  for (const linha of readFileSync(path, "utf8").split("\n")) {
    let e: any;
    try {
      e = JSON.parse(linha);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    if (e.type === "ai-title" && e.aiTitle) titulo = String(e.aiTitle);
    if (!projetoPath && typeof e.cwd === "string") projetoPath = e.cwd;
    const t = Date.parse(e.timestamp);
    if (!Number.isNaN(t) && (e.type === "user" || e.type === "assistant")) tempos.push(t);

    if (e.type === "user") {
      for (const m of textoDoUsuario(e)) mensagens.push(cortar(m, MAX_MSG));
      const c = e.message?.content;
      if (Array.isArray(c)) for (const b of c) if (b?.type === "tool_result" && b.is_error) erros++;
    } else if (e.type === "assistant" && !e.isSidechain) {
      const c = e.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b?.type !== "tool_use") continue;
        ferramentas[b.name] = (ferramentas[b.name] ?? 0) + 1;
        const arq = b.input?.file_path ?? b.input?.notebook_path;
        if (EDIT_TOOLS.has(b.name) && typeof arq === "string") {
          const rel = projetoPath ? relative(projetoPath, arq) : arq;
          arquivos.add(rel.startsWith("..") ? arq : rel);
        }
        if (b.name === "Bash" && /\bgit\s+(-\S+\s+)*commit\b/.test(String(b.input?.command ?? ""))) commits++;
      }
    }
  }

  if (!mensagens.length && !Object.keys(ferramentas).length) return null;
  tempos.sort((a, b) => a - b);
  let ativo = 0;
  for (let i = 1; i < tempos.length; i++) ativo += Math.min(tempos[i] - tempos[i - 1], MAX_GAP_MS);
  const inicio = tempos[0] ?? statSync(path).mtimeMs;
  const fim = tempos.at(-1) ?? inicio;

  return {
    session: sessionId,
    titulo,
    projeto: nomeProjeto(projetoPath),
    projeto_path: projetoPath,
    inicio: new Date(inicio).toISOString(),
    fim: new Date(fim).toISOString(),
    ativo_min: Math.round(ativo / 60000),
    mensagens,
    arquivos: [...arquivos],
    ferramentas,
    erros_ferramenta: erros,
    commits,
    log: acharLog(projetoPath, sessionId),
    fonte_mtime: statSync(path).mtimeMs,
  };
}

function caminhoFicha(f: Ficha): string {
  const d = new Date(f.inicio);
  return join(HIST, String(d.getFullYear()), pad(d.getMonth() + 1), f.projeto, "sessoes", `${f.session}.json`);
}

function conversas(): { id: string; path: string; mtime: number }[] {
  if (!existsSync(PROJECTS)) return [];
  const lista = [];
  for (const proj of readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const dir = join(PROJECTS, proj.name);
    for (const arq of readdirSync(dir, { withFileTypes: true })) {
      if (!arq.isFile() || !arq.name.endsWith(".jsonl")) continue;
      const path = join(dir, arq.name);
      lista.push({ id: arq.name.slice(0, -".jsonl".length), path, mtime: statSync(path).mtimeMs });
    }
  }
  return lista;
}

export function arquivar(): number {
  const estado = lerEstado();
  const projetos = new Set(estado.projetos);
  let novas = 0;
  for (const c of conversas()) {
    if (estado.arquivadas[c.id] === c.mtime) continue;
    let ficha: Ficha | null;
    try {
      ficha = lerConversa(c.path, c.id);
    } catch (err) {
      console.error(`historico: ${c.path}: ${err}`);
      continue;
    }
    if (!ficha) continue; // conversa vazia: tenta de novo quando mudar
    salvar(caminhoFicha(ficha), `${JSON.stringify(ficha, null, 2)}\n`);
    estado.arquivadas[c.id] = c.mtime;
    if (ficha.projeto_path) projetos.add(ficha.projeto_path);
    novas++;
  }
  estado.projetos = [...projetos].sort();
  salvar(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
  return novas;
}

// ---------- leitura do histórico ----------

function fichasDoMes(ym: string): Ficha[] {
  const [ano, mes] = ym.split("-");
  const dir = join(HIST, ano, mes);
  if (!existsSync(dir)) return [];
  const fichas: Ficha[] = [];
  for (const proj of readdirSync(dir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const sdir = join(dir, proj.name, "sessoes");
    if (!existsSync(sdir)) continue;
    for (const arq of readdirSync(sdir)) {
      const f = lerJson<Ficha | null>(join(sdir, arq), null);
      if (f) fichas.push(f);
    }
  }
  return fichas.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

type Log = {
  path: string;
  projeto: string;
  projeto_path: string;
  data: string;
  titulo: string;
  meta: Record<string, string>;
  copias: string[]; // mesmo conteúdo em outros projetos (pasta copiada entre repos)
};

function frontmatter(texto: string): Record<string, string> {
  const m = texto.match(/^---\n([\s\S]*?)\n---/);
  const meta: Record<string, string> = {};
  if (!m) return meta;
  for (const linha of m[1].split("\n")) {
    const kv = linha.match(/^([\w-]+):\s*(.*?)\s*(#.*)?$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return meta;
}

// Logs de sessão (raiz de .claude/logs/) de todos os projetos já vistos. Logs
// idênticos em mais de um projeto contam uma vez, no primeiro projeto em ordem.
// O filtro vem antes da deduplicação: a cópia que fica é uma das pastas pedidas.
function todosOsLogs(casa: (path: string) => boolean = () => true): Log[] {
  const logs: Log[] = [];
  const vistos = new Map<string, Log>();
  for (const proj of lerEstado().projetos.filter(casa)) {
    const dir = join(proj, ".claude", "logs");
    if (!existsSync(dir)) continue;
    for (const nome of readdirSync(dir)) {
      if (!nome.endsWith(".md")) continue;
      const path = join(dir, nome);
      let texto: string;
      try {
        texto = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const hash = createHash("sha1").update(texto).digest("hex");
      const original = vistos.get(hash);
      if (original) {
        original.copias.push(path);
        continue;
      }
      const meta = frontmatter(texto);
      const data = (meta.date || nome.slice(0, 10)).slice(0, 10);
      const titulo = texto.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? nome;
      const log = { path, projeto: nomeProjeto(proj), projeto_path: proj, data, titulo, meta, copias: [] };
      vistos.set(hash, log);
      logs.push(log);
    }
  }
  return logs.sort((a, b) => a.data.localeCompare(b.data));
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function numMes(t: string): number | null {
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  const s = semAcento(t);
  // "nov", "novembro", "marco"/"março"; exige ao menos as 3 primeiras letras.
  const i = MESES.findIndex((m) => s.length >= 3 && (s.startsWith(m) || m.startsWith(s)) && s.slice(0, 3) === m);
  return i >= 0 ? i + 1 : null;
}

// Lê o mês do início de `args`: "2026-11", "11/2026", "nov/26", "novembro 2026", "nov", "11".
// Sem ano, usa o ano atual. Devolve o mês e os argumentos que sobraram (as pastas).
export function lerMes(args: string[], hoje = new Date()): { ym: string; resto: string[] } | null {
  if (!args.length) return null;
  const partes = args[0].split(/[-/.]/).filter(Boolean);
  let ano: number | null = null;
  let mes: number | null = null;
  if (partes.length === 2 && /^\d{4}$/.test(partes[0])) {
    ano = Number(partes[0]);
    mes = numMes(partes[1]);
  } else if (partes.length === 2 && /^\d{2}(\d{2})?$/.test(partes[1])) {
    mes = numMes(partes[0]);
    ano = Number(partes[1].length === 2 ? `20${partes[1]}` : partes[1]);
  } else if (partes.length === 1) {
    mes = numMes(partes[0]);
  }
  if (!mes) return null;
  let resto = args.slice(1);
  if (ano === null && /^\d{4}$/.test(resto[0] ?? "")) {
    ano = Number(resto[0]);
    resto = resto.slice(1);
  }
  return { ym: `${ano ?? hoje.getFullYear()}-${pad(mes)}`, resto };
}

// Filtro por pastas: pasta existente casa com tudo que está dentro dela; texto que
// não é pasta casa como trecho do caminho ("dataviva"). Sem filtro, casa tudo.
type Filtro = (projetoPath: string) => boolean;

function filtroPastas(pastas: string[]): Filtro {
  if (!pastas.length) return () => true;
  const regras = pastas.map((p) => {
    const abs = resolve(p.startsWith("~") ? join(homedir(), p.slice(1)) : p);
    if (existsSync(abs)) {
      const raiz = real(abs);
      return (path: string) => {
        const r = real(path);
        return r === raiz || r.startsWith(raiz + sep);
      };
    }
    const trecho = p.toLowerCase();
    return (path: string) => path.toLowerCase().includes(trecho);
  });
  return (path) => regras.some((r) => r(path));
}

export function digestMes(ym: string, pastas: string[] = []): string {
  const casa = filtroPastas(pastas);
  const filtro = pastas.join(", ");
  const fichas = fichasDoMes(ym).filter((f) => casa(f.projeto_path));
  const logs = todosOsLogs(casa).filter((l) => l.data.startsWith(ym));
  // Agrupa pelo caminho: pastas diferentes com o mesmo nome (~/.ssh/dataviva e
  // ~/Documentos/dataviva) são projetos diferentes.
  const projetos = new Map<string, { nome: string; path: string; fichas: Ficha[]; logs: Log[] }>();
  const de = (nome: string, path: string) => {
    if (!projetos.has(path)) projetos.set(path, { nome, path, fichas: [], logs: [] });
    return projetos.get(path)!;
  };
  for (const f of fichas) de(f.projeto, f.projeto_path).fichas.push(f);
  for (const l of logs) de(l.projeto, l.projeto_path).logs.push(l);
  const repetidos = new Set(
    [...projetos.values()].map((p) => p.nome).filter((n, i, todos) => todos.indexOf(n) !== i),
  );

  const comLog = new Set(logs.map((l) => l.path));
  const tarefas = (p: { fichas: Ficha[]; logs: Log[] }) =>
    p.logs.length + p.fichas.filter((f) => !f.log || !comLog.has(f.log)).length;
  const ordem = [...projetos.entries()].sort((a, b) => tarefas(b[1]) - tarefas(a[1]));

  const out: string[] = [`# Digest ${ym}${filtro ? ` (filtro: ${filtro})` : ""}`, ""];
  out.push(`${projetos.size} projeto(s) · ${fichas.length} sessão(ões) com ficha · ${logs.length} log(s) de auditoria`);
  out.push(`Lições globais: ${join(CLAUDE_DIR, "rules", "licoes.md")}`, "");
  for (const [, p] of ordem) {
    const nome = p.nome;
    const rotulo = repetidos.has(nome) ? `${nome} (${p.path})` : nome;
    out.push(`## ${rotulo} — ${tarefas(p)} tarefa(s)`, `caminho: ${p.path}`);
    const licoes = join(p.path, ".claude", "rules", "licoes.md");
    if (existsSync(licoes)) out.push(`lições do projeto: ${licoes}`);
    const resumo = join(HIST, ...ym.split("-"), nome, "resumo.md");
    if (existsSync(resumo)) out.push(`resumo existente: ${resumo}`);
    if (p.logs.length) {
      out.push("", "### Logs de auditoria");
      for (const l of p.logs) {
        out.push(`- ${l.data} · ${l.titulo} · tipo: ${l.meta.tipo ?? "?"} · status: ${l.meta.status ?? "?"} · revisao: ${l.meta.revisao ?? "?"} · ${l.path}` +
          (l.copias.length ? ` · cópia idêntica em: ${l.copias.join(", ")}` : ""));
      }
    }
    if (p.fichas.length) {
      out.push("", "### Sessões");
      for (const f of p.fichas) {
        const ferr = Object.entries(f.ferramentas).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(" ");
        out.push(
          `- ${dia(new Date(f.inicio))} · ${f.ativo_min} min ativos · "${f.titulo || "sem título"}" · ${f.mensagens.length} msg · ` +
            `${f.arquivos.length} arquivo(s) · ${f.erros_ferramenta} erro(s) de ferramenta · ${f.commits} commit(s) · ` +
            `log: ${f.log ?? "nenhum"} · ferramentas: ${ferr || "-"} · id: ${f.session}`,
        );
        for (const m of f.mensagens) out.push(`  > ${cortar(m, MAX_MSG_DIGEST).replace(/\s*\n\s*/g, " ⏎ ")}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

function arquivosRecursivos(dir: string, fim: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).filter((n) => n.endsWith(fim)).map((n) => join(dir, n));
}

export function buscar(termos: string[]): string {
  const ts = termos.map((t) => t.toLowerCase()).filter(Boolean);
  if (!ts.length) return "Informe ao menos um termo.";
  type Achado = { tipo: string; data: string; projeto: string; path: string; titulo: string; termos: number; ocorrencias: number; bonus: number; trecho: string };
  const achados: Achado[] = [];
  const avaliar = (tipo: string, data: string, projeto: string, path: string, titulo: string, texto: string) => {
    const baixo = texto.toLowerCase();
    const tit = `${titulo} ${basename(path)}`.toLowerCase();
    let termosAchados = 0;
    let ocorrencias = 0;
    let bonus = 0;
    let trecho = "";
    for (const t of ts) {
      const n = baixo.split(t).length - 1;
      if (!n) continue;
      termosAchados++;
      ocorrencias += n;
      if (tit.includes(t)) bonus++;
      if (!trecho) {
        const i = baixo.indexOf(t);
        trecho = texto.slice(Math.max(0, i - 80), i + 120).replace(/\s+/g, " ").trim();
      }
    }
    if (termosAchados) achados.push({ tipo, data, projeto, path, titulo, termos: termosAchados, ocorrencias, bonus, trecho });
  };

  for (const l of todosOsLogs()) {
    try {
      avaliar("log", l.data, l.projeto, l.path, l.titulo, readFileSync(l.path, "utf8"));
    } catch {
      continue;
    }
  }
  for (const path of arquivosRecursivos(HIST, ".json")) {
    if (!path.includes(`${sep}sessoes${sep}`)) continue;
    const f = lerJson<Ficha | null>(path, null);
    if (!f) continue;
    avaliar("sessão", dia(new Date(f.inicio)), f.projeto, path, f.titulo, [f.titulo, ...f.mensagens, ...f.arquivos].join("\n"));
  }
  for (const path of arquivosRecursivos(HIST, "indice.md")) {
    for (const linha of readFileSync(path, "utf8").split("\n")) {
      if (!linha.startsWith("- ")) continue;
      const data = linha.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
      avaliar("índice", data, "", path, "", linha);
    }
  }

  achados.sort((a, b) => b.termos - a.termos || b.bonus - a.bonus || b.ocorrencias - a.ocorrencias);
  if (!achados.length) return `Nada encontrado para: ${ts.join(", ")}`;
  const out = [`${achados.length} resultado(s) para: ${ts.join(", ")} (mostrando até 15)`, ""];
  for (const a of achados.slice(0, 15)) {
    out.push(`- [${a.tipo}] ${a.data} · ${a.projeto || "-"} · ${a.titulo || "-"} · termos ${a.termos}/${ts.length} · ${a.ocorrencias}x · ${a.path}`);
    out.push(`  … ${a.trecho} …`);
  }
  return out.join("\n");
}

// Meses já fechados com fichas mais novas que o resumo do mês (ou sem resumo).
export function pendentes(hoje = new Date()): string[] {
  const atual = anoMes(hoje);
  const lista: string[] = [];
  if (!existsSync(HIST)) return lista;
  for (const ano of readdirSync(HIST).filter((n) => /^\d{4}$/.test(n)).sort()) {
    for (const mes of readdirSync(join(HIST, ano)).filter((n) => /^\d{2}$/.test(n)).sort()) {
      const ym = `${ano}-${mes}`;
      if (ym >= atual) continue;
      const fichas = arquivosRecursivos(join(HIST, ano, mes), ".json");
      if (!fichas.length) continue;
      const resumo = join(HIST, ano, mes, "resumo.md");
      const maisNova = Math.max(...fichas.map((f) => statSync(f).mtimeMs));
      if (!existsSync(resumo) || statSync(resumo).mtimeMs < maisNova) lista.push(ym);
    }
  }
  return lista;
}

function hook(): void {
  let data: any = {};
  try {
    data = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    data = {};
  }
  arquivar();
  if (data.hook_event_name !== "SessionStart") return;
  const meses = pendentes();
  const hoje = dia(new Date());
  const estado = lerEstado();
  if (!meses.length || estado.ultimo_aviso === hoje) return;
  estado.ultimo_aviso = hoje;
  salvar(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
  const additionalContext =
    `Histórico de sessões: ${meses.length === 1 ? "o mês" : "os meses"} ${meses.join(", ")} ` +
    `já ${meses.length === 1 ? "fechou" : "fecharam"} e ${meses.length === 1 ? "tem" : "têm"} sessões sem relatório atualizado. ` +
    `Em uma frase, no início da sua primeira resposta, ofereça ao usuário rodar /relatorio ${meses[0]}.`;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}

function main(): void {
  const [cmd, ...resto] = process.argv.slice(2);
  const mes = cmd === "mes" ? lerMes(resto) : null;
  if (cmd === "arquivar") console.log(`${arquivar()} conversa(s) arquivada(s) em ${HIST}`);
  else if (mes) console.log(digestMes(mes.ym, mes.resto));
  else if (cmd === "buscar") console.log(buscar(resto));
  else if (cmd === "pendentes") console.log(pendentes().join("\n") || "nenhum");
  else if (!cmd) hook();
  else {
    console.log(
      "Uso: historico.mjs [arquivar | mes <mês> [ano] [pastas...] | buscar <termos...> | pendentes]\n" +
        "  <mês>: novembro, nov, 11, 11/2026, nov/26, 2026-11 (sem ano = ano atual)",
    );
    process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  // erro não bloqueante: aparece como aviso, a sessão segue
  console.error(`historico: ${err}`);
  process.exitCode = 1;
}
