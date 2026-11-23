// Testes de ponta a ponta: instala numa pasta temporária, roda os hooks e desinstala.
// Rodam em Linux, macOS e Windows no CI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "cli.js");

function cli(dir: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, [CLI, ...args, "--yes", "--dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function hook(file: string, input: object, ...args: string[]) {
  return spawnSync(process.execPath, [file, ...args], { input: JSON.stringify(input), encoding: "utf8" });
}

const settingsOf = (dir: string) => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));

test("instala, é idempotente e preserva o que é do usuário", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Meu\n\nfoo\n");
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "meu-hook" }] }] } }),
  );

  cli(dir);
  for (const f of ["rules/como-trabalhar.md", "rules/auditoria.md", "rules/licoes.md", "templates/session-log.md",
    "hooks/check-session-log.mjs", "hooks/claude-notify.mjs", "hooks/historico.mjs", "skills/revisar-logs/SKILL.md",
    "skills/relatorio/SKILL.md"]) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.ok(claudeMd.startsWith("# Meu"));
  assert.ok(claudeMd.includes("<!-- claude-audit:start -->"));

  const settings = settingsOf(dir);
  const stop = settings.hooks.Stop.flatMap((e: any) => e.hooks.map((h: any) => h.command));
  assert.equal(stop.length, 2);
  assert.ok(stop.includes("meu-hook"));
  assert.equal(settings.attribution.commit, "");
  for (const ev of ["SessionStart", "SessionEnd"]) {
    assert.ok(settings.hooks[ev][0].hooks[0].command.includes("historico.mjs"), ev);
  }

  const again = cli(dir);
  assert.ok(!again.includes("  + "), again);
});

test("hook de log bloqueia sem log e libera com log da sessão", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  cli(dir);
  // Fora da pasta de config: o hook ignora edições dentro dela.
  const proj = mkdtempSync(join(tmpdir(), "claude-audit-proj-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: join(proj, "a.txt") } }] },
    }),
  );
  const input = { session_id: "abc", transcript_path: transcript, cwd: proj };
  const file = join(dir, "hooks", "check-session-log.mjs");

  const blocked = hook(file, input);
  assert.equal(blocked.status, 0, blocked.stderr);
  const out = JSON.parse(blocked.stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(join(dir, "templates", "session-log.md")));

  mkdirSync(join(proj, ".claude", "logs"), { recursive: true });
  writeFileSync(join(proj, ".claude", "logs", "x.md"), "---\nsession: abc\n---\n");
  const released = hook(file, input);
  assert.equal(released.status, 0, released.stderr);
  assert.equal(released.stdout.trim(), "");
});

test("hook de notificação nunca falha", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  cli(dir);
  const file = join(dir, "hooks", "claude-notify.mjs");
  assert.equal(hook(file, { background_tasks: [{ status: "running" }] }, "stop").status, 0);
  assert.equal(hook(file, {}, "input").status, 0);
});

test("histórico: arquiva conversa em ficha, busca e avisa mês fechado", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  cli(dir);
  const proj = mkdtempSync(join(tmpdir(), "claude-audit-proj-"));
  mkdirSync(join(proj, ".claude", "logs"), { recursive: true });
  writeFileSync(
    join(proj, ".claude", "logs", "2020-01-15-webhook.md"),
    "---\nsession: s1\ndate: 2020-01-15\nrevisao: pendente\n---\n\n# Webhook do Asaas\n",
  );
  // Cópia idêntica em outro projeto conta uma vez só.
  const copia = mkdtempSync(join(tmpdir(), "claude-audit-proj-"));
  mkdirSync(join(copia, ".claude", "logs"), { recursive: true });
  writeFileSync(
    join(copia, ".claude", "logs", "2020-01-15-webhook.md"),
    readFileSync(join(proj, ".claude", "logs", "2020-01-15-webhook.md")),
  );
  const linhas = (cwd: string, ...entradas: object[]) => entradas.map((e) => JSON.stringify({ cwd, ...e })).join("\n");
  mkdirSync(join(dir, "projects", "p"), { recursive: true });
  writeFileSync(
    join(dir, "projects", "p", "s1.jsonl"),
    linhas(
      proj,
      { type: "ai-title", aiTitle: "Webhook do pagamento" },
      { type: "user", timestamp: "2020-01-15T12:00:00Z", origin: { kind: "human" }, message: { content: "faz o webhook<system-reminder>ruído</system-reminder>" } },
      { type: "user", timestamp: "2020-01-15T12:00:01Z", message: { content: "<command-name>/relatorio</command-name><command-args>busca x</command-args>" } },
      { type: "user", timestamp: "2020-01-15T12:00:02Z", origin: { kind: "task-notification" }, message: { content: "não é do usuário" } },
      { type: "user", timestamp: "2020-01-15T12:00:03Z", isMeta: true, message: { content: "meta" } },
      {
        type: "assistant",
        timestamp: "2020-01-15T12:05:00Z",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { file_path: join(proj, "src", "a.ts") } },
            { type: "tool_use", name: "Bash", input: { command: "git commit -m 'feat: x'" } },
          ],
        },
      },
      { type: "user", timestamp: "2020-01-15T12:06:00Z", message: { content: [{ type: "tool_result", is_error: true, content: "falhou" }] } },
    ),
  );
  writeFileSync(join(dir, "projects", "p", "s2.jsonl"), linhas(copia, { type: "user", timestamp: "2020-01-16T12:00:00Z", message: { content: "outra" } }));
  const hist = join(dir, "hooks", "historico.mjs");
  const rodar = (...args: string[]) => spawnSync(process.execPath, [hist, ...args], { encoding: "utf8" });

  assert.match(rodar("arquivar").stdout, /^2 conversa/);
  assert.match(rodar("arquivar").stdout, /^0 conversa/, "idempotente");

  const nome = proj.split(/[\\/]/).at(-1)!;
  const ficha = JSON.parse(readFileSync(join(dir, "historico", "2020", "01", nome, "sessoes", "s1.json"), "utf8"));
  assert.equal(ficha.titulo, "Webhook do pagamento");
  assert.deepEqual(ficha.mensagens, ["faz o webhook", "/relatorio busca x"]);
  assert.deepEqual(ficha.arquivos, [join("src", "a.ts")]);
  assert.equal(ficha.commits, 1);
  assert.equal(ficha.erros_ferramenta, 1);
  assert.equal(ficha.ativo_min, 6);
  assert.ok(ficha.log.endsWith("2020-01-15-webhook.md"));

  const digest = rodar("mes", "2020-01").stdout;
  assert.match(digest, /1 log\(s\) de auditoria/);
  assert.match(digest, /cópia idêntica em/);

  // Mês por nome, abreviação ou número; sem ano = ano atual.
  for (const args of [["janeiro", "2020"], ["jan/2020"], ["01/2020"], ["1", "2020"], ["jan/20"], ["2020-1"]]) {
    assert.match(rodar("mes", ...args).stdout, /^# Digest 2020-01/, args.join(" "));
  }
  const ano = new Date().getFullYear();
  assert.match(rodar("mes", "março").stdout, new RegExp(`^# Digest ${ano}-03`));
  assert.match(rodar("mes", "11").stdout, new RegExp(`^# Digest ${ano}-11`));
  assert.equal(rodar("mes", "xyz").status, 1);

  // Filtro por uma ou mais pastas (tudo que está dentro delas).
  assert.match(rodar("mes", "jan", "2020", proj).stdout, /1 sessão\(ões\) com ficha/);
  assert.match(rodar("mes", "jan", "2020", copia).stdout, /1 sessão\(ões\) com ficha · 1 log/);
  assert.match(rodar("mes", "jan", "2020", proj, copia).stdout, /2 sessão\(ões\) com ficha · 1 log/);
  assert.match(rodar("mes", "jan", "2020", tmpdir()).stdout, /2 sessão\(ões\) com ficha/);

  const busca = rodar("buscar", "webhook", "asaas").stdout;
  assert.match(busca, /\[log\].*Webhook do Asaas.*termos 2\/2/);
  assert.match(rodar("buscar", "inexistente").stdout, /Nada encontrado/);

  const inicio = hook(hist, { hook_event_name: "SessionStart" });
  assert.equal(inicio.status, 0, inicio.stderr);
  assert.match(JSON.parse(inicio.stdout).hookSpecificOutput.additionalContext, /\/relatorio 2020-01/);
  assert.equal(hook(hist, { hook_event_name: "SessionStart" }).stdout.trim(), "", "avisa no máximo uma vez por dia");
});

test("desinstala só o que é do pacote", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Meu\n\nfoo\n");
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "meu-hook" }] }] } }),
  );
  cli(dir);
  mkdirSync(join(dir, "historico", "2020", "01"), { recursive: true });
  writeFileSync(join(dir, "historico", "2020", "01", "resumo.md"), "meu histórico");
  cli(dir, "uninstall");

  assert.ok(!existsSync(join(dir, "hooks", "check-session-log.mjs")));
  assert.ok(!existsSync(join(dir, "hooks", "historico.mjs")));
  assert.ok(!existsSync(join(dir, "skills", "relatorio", "SKILL.md")));
  assert.equal(readFileSync(join(dir, "historico", "2020", "01", "resumo.md"), "utf8"), "meu histórico");
  assert.ok(!existsSync(join(dir, "rules", "auditoria.md")));
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# Meu\n\nfoo\n");
  assert.deepEqual(settingsOf(dir).hooks, { Stop: [{ hooks: [{ type: "command", command: "meu-hook" }] }] });
});
