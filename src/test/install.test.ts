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
    "hooks/check-session-log.mjs", "hooks/claude-notify.mjs", "skills/revisar-logs/SKILL.md"]) {
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

test("desinstala só o que é do pacote", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-audit-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Meu\n\nfoo\n");
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "meu-hook" }] }] } }),
  );
  cli(dir);
  cli(dir, "uninstall");

  assert.ok(!existsSync(join(dir, "hooks", "check-session-log.mjs")));
  assert.ok(!existsSync(join(dir, "rules", "auditoria.md")));
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# Meu\n\nfoo\n");
  assert.deepEqual(settingsOf(dir).hooks, { Stop: [{ hooks: [{ type: "command", command: "meu-hook" }] }] });
});
