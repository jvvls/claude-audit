# Lições aprendidas (todos os projetos)

Erros reais cometidos pelo Claude, revisados por um humano e promovidos a regra. Este arquivo carrega em toda sessão, em qualquer projeto. Lições de um projeto só ficam em `<projeto>/.claude/rules/licoes.md`.

Regras para este arquivo:
- Só entra o que um humano aprovou (via `/revisar-logs`). O Claude não adiciona entradas por conta própria.
- Uma lição = um padrão que pode se repetir, não a história de um bug. O detalhe fica no log de origem.
- Formato: **Regra** (imperativa) · **Camada** · **Por quê** (o erro concreto, em 1–2 linhas) · **Origem** (log ou data).
- Quando uma lição ficar obsoleta ou for incorporada a um CLAUDE.md ou arquivo de regras, remova daqui.

---

### L1. Shell frágil: gravar arquivo e matar processo
- **Camada:** ambiente (shell desta máquina)
- **Regra:** Grave arquivo só com Write/Edit, nunca com `cat >> arquivo <<EOF`: aqui `cat` é alias de `bat` e falha em silêncio, sem gravar nada. Para matar processo, use `pgrep` e depois `kill <pid>` em chamada separada, nunca `pkill -f <padrão>`: o padrão aparece na linha de comando do próprio shell e o mata.
- **Por quê:** `cat >>` não gravou nada em 12/10, 13/10 e 14/10 (a regra de `como-trabalhar.md` já mandava usar Edit); `pkill -f` matou o shell 3 vezes (exit 144).
- **Origem:** logs `2026-10-12-secex-tools-comercio.md`, `2026-10-13-contexto-dividido-e-apresentacao.md`, `2026-10-14-teste-ao-vivo-tpm.md`

### L2. Use as palavras do usuário e ecoe a interpretação
- **Camada:** comunicação (qualquer projeto)
- **Regra:** Ao registrar uma decisão, use os termos do usuário, sem renomear. Quando um termo dele puder ter mais de um sentido, diga em uma frase como o entendeu ("entendi X como Y") antes de implementar; pergunte só se as notas e o código não responderem. Antes de perguntar o que um termo significa, releia o log e as notas da tarefa.
- **Por quê:** "fechar o secex" foi perguntado quando estava nas notas; "pode salvar igual em ambos" foi lido como sobre o log sem confirmar; "resumo atual + mapa" foi registrado com nome meu, contra o "sem topos" já decidido; "limite arbitrário" era pedido para aumentar as iterações. Cada um virou retrabalho.
- **Origem:** logs `2026-10-12-secex-tools-comercio.md` e `2026-10-13-contexto-dividido-e-apresentacao.md` (2026-10-12 a 14)
