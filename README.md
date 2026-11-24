# claude-audit

Regras de trabalho, logs de sessão auditáveis e lições revisadas por humano para o Claude Code. O Claude registra o que fez e onde errou; você revisa; os erros que podem se repetir viram regras que carregam em toda sessão futura.

## Instalação

```bash
npx github:jvvls/claude-audit
npx github:jvvls/claude-audit uninstall
```

Para fixar uma versão, use uma tag ou commit: `npx github:jvvls/claude-audit#v0.1.0`.

Funciona em Linux, macOS e Windows (testado no CI nos três). Só requer Node ≥ 20; instalador e hooks são TypeScript compilado, sem outras dependências. O instalador:

- copia para `~/.claude/` (ou `$CLAUDE_CONFIG_DIR`) as regras, o template de log, os hooks e as skills `/revisar-logs`, `/relatorio` e `/push`, com backup `.bak-<data>` do que for sobrescrito (`rules/licoes.md` nunca é sobrescrito);
- adiciona ao `~/.claude/CLAUDE.md` um bloco de commits entre marcadores `claude-audit`;
- registra no `settings.json` o hook de log e o de histórico, e desliga o trailer `Co-Authored-By`;
- pergunta se ativa a notificação de desktop (desativada por padrão; usa `notify-send` no Linux, `osascript` no macOS, toast do PowerShell no Windows);
- pergunta se instala os plugins recomendados.

`--yes` aceita os padrões sem perguntar (sem notificação, sem plugins). `--dir <pasta>` instala em outra pasta. Rodar de novo é seguro: só altera o que mudou, e a resposta sobre notificação liga ou desliga os hooks dela.

`uninstall` remove os arquivos que não foram alterados (pergunta sobre os alterados, como um `licoes.md` com lições suas), o bloco do `CLAUDE.md` e os hooks do pacote no `settings.json`, mantendo seus outros hooks. Logs dos projetos, o histórico em `~/.claude/historico/` e plugins ficam.

## O que vem no pacote

| Peça | Destino | Função |
|---|---|---|
| `como-trabalhar.md` | `rules/` | Escopo, perguntar uma vez, baseline, evidência, diagnóstico como hipótese, relatório final |
| `auditoria.md` | `rules/` | Onde e quando escrever o log de sessão; ciclo log → revisão → lição |
| `licoes.md` | `rules/` | Lições globais aprovadas por humano (começa com L1–L2) |
| `session-log.md` | `templates/` | Estrutura do log: hipóteses, decisões com fonte, correções, validação |
| `check-session-log.mjs` | `hooks/` (Stop) | Bloqueia o fim do turno se a sessão editou arquivos do projeto e não há log com o `session:` dela |
| `claude-notify.mjs` | `hooks/` (Stop e Notification, opcional) | Notifica ao terminar (exceto com subagents ainda rodando) e ao pedir input |
| `historico.mjs` | `hooks/` (SessionStart e SessionEnd) | Guarda cada conversa como ficha (com custo estimado) em `historico/AAAA/MM/<projeto>/` antes que o Claude Code a apague (30 dias); avisa de mês fechado sem relatório |
| `revisar-logs` | `skills/` | Revisão humana dos logs e promoção de lições |
| `relatorio` | `skills/` | Relatório mensal e anual (geral ou por projeto) cruzado com as lições, e busca de tarefas antigas |
| `push` | `skills/` | `/push`: commita o que está pendente em commits atômicos (Conventional Commits, sem `Co-Authored-By`) e faz push para a branch atual, sem nunca forçar; só roda quando você digita |
| bloco de commits | `CLAUDE.md` | Conventional Commits, `--no-gpg-sign`, sem `Co-Authored-By`, um commit por tarefa |

## Fluxo de uso

1. **Trabalhe normalmente.** Ao iniciar uma tarefa, o Claude lê os logs de `<projeto>/.claude/logs/` com slug parecido.
2. **Durante a tarefa**, o Claude escreve `<projeto>/.claude/logs/AAAA-MM-DD-<slug>.md` com hipóteses (inclusive descartadas), decisões e suas fontes, e onde foi corrigido. O campo `revisao: pendente` só é alterado por você.
3. **No fim do turno**, o hook confere: houve edição no projeto sem log desta sessão? Então o Claude é obrigado a escrever o log antes de parar. Para desligar num projeto, crie `.claude/audit-off`.
4. **Quando quiser revisar**, rode `/revisar-logs`. A skill lista os logs pendentes, aponta erros e diagnósticos furados e propõe lições. Você aprova cada uma e escolhe o nível: global (`~/.claude/rules/licoes.md`) ou do projeto (`<projeto>/.claude/rules/licoes.md`).
5. **As lições aprovadas** carregam em toda sessão seguinte. Quando uma vira regra permanente num CLAUDE.md, sai do arquivo de lições.

## Histórico e relatórios

O `/insights` nativo sobrescreve o relatório anterior, analisa só parte das sessões e não lê os logs de auditoria. Este pacote mantém um histórico próprio:

- **Fichas, sem chamar modelo.** No início e no fim de cada sessão, o hook `historico.mjs` lê as conversas de `~/.claude/projects/` e grava uma ficha por sessão em `~/.claude/historico/AAAA/MM/<projeto>/sessoes/<id>.json`: título, projeto, minutos ativos, mensagens do usuário (cada uma limitada a 2000 caracteres), arquivos editados, erros de ferramenta, commits e o log de auditoria ligado. Só código, sem modelo.
- **Custo por sessão.** A ficha também traz os tokens (entrada, saída, leitura e escrita de cache), o custo por modelo e o total em `custo_usd`, com os subagentes incluídos e mostrados à parte em `custo_subagentes_usd`. É uma estimativa a preço de API, feita com a tabela em `historico.mjs`, e não o que a assinatura cobra. Conversas que o Claude Code já apagou não podem ser medidas, então as fichas delas ficam sem custo.
- **`/relatorio <mês> [pastas...]`** — mês por nome, abreviação ou número (`novembro`, `nov`, `11`, `11/2026`; sem ano, o atual), filtrado por uma ou mais pastas (entra tudo que está dentro delas) — escreve `historico/AAAA/MM/<projeto>/resumo.md`, o `resumo.md` geral do mês e um `indice.md` com palavras-chave por tarefa. A fonte principal são os logs de auditoria; cada projeto e cada tarefa aparecem, independente do tamanho da conversa. O relatório cruza com as lições: quais nasceram no mês, quais erros voltaram apesar de já haver lição, quais logs seguem pendentes de revisão.
- **`/relatorio ano [AAAA] [pastas...]`** monta o anual a partir dos mensais (sem ano, o atual). `~/Documentos/dataviva` junta todos os repos dentro dela; um texto que não é pasta vale como trecho do caminho.
- **`/relatorio busca <descrição>`** procura nos logs, nas fichas e nos índices (e no claude-mem, se instalado) e responde data, projeto e o caminho do log.
- **Lembrete:** quando um mês fecha sem relatório, a sessão seguinte começa oferecendo `/relatorio AAAA-MM` (no máximo uma vez por dia).

O script também roda à mão: `node ~/.claude/hooks/historico.mjs arquivar | mes <mês> [ano] [pastas...] | buscar <termos...> | pendentes`.

Logs ficam por projeto, não em pasta central. Recomenda-se ignorar `.claude/logs/` no git (ex.: `**/.claude/logs/` no `~/.config/git/ignore`).

## Plugins recomendados

O instalador oferece instalar cada um; para fazer à mão:

```bash
# GSD — fluxo de fases (discuss → plan → execute → verify) com commits atômicos
npx get-shit-done-cc@latest --claude --global

# claude-mem — memória persistente entre sessões
claude plugin marketplace add thedotmack/claude-mem
claude plugin install claude-mem@thedotmack

# context-mode — mantém saídas grandes fora da janela de contexto
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

## Desenvolvimento

```bash
npm install && npm test
node dist/cli.js --dir /tmp/teste-claude
```

Textos instalados ficam em `assets/`; o instalador em `src/cli.ts`; os hooks em `src/hooks/`; os testes de ponta a ponta em `src/test/`, rodados pelo GitHub Actions em Linux, macOS e Windows.
