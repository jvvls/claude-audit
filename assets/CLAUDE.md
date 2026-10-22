- Regras gerais de trabalho e auditoria ficam em `~/.claude/rules/`.

## Commits

- Ao criar commits diretamente (fora de fluxos automatizados como o GSD), **não** adicione a linha `Co-Authored-By: Claude ...` no final da mensagem. Assine apenas com a mensagem em si, sem trailer de autoria.
- Sempre use --no-gpg-sign

### Padrão de mensagem (Conventional Commits)

Toda mensagem de commit deve seguir o padrão:

```
<tipo>(<escopo opcional>): <descrição curta, no imperativo, minúscula, sem ponto final>

- <detalhe 1, se necessário>
- <detalhe 2, se necessário>
```

- **Tipos válidos:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- **Título (subject):** até 72 caracteres, modo imperativo ("adiciona", "corrige", "remove" — não "adicionado", "adicionando").
- **O prefixo `tipo(escopo):` é obrigatório em TODO commit, sem exceção** — inclusive em workspaces multi-repo. Nunca commitar só com um título solto. Antes de rodar `git commit`, confira se a mensagem bate com `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?: .+`.
- **Corpo enxuto:** no máximo 3 bullets, cada um descrevendo uma mudança de alto nível (o quê, não como). Nada de listar cada linha alterada, nome de variável, ou detalhe de implementação — isso é ruído, não descrição. Se não der pra resumir em até 3 bullets, é sinal de que o commit deveria ser dividido.
- **Um commit = uma tarefa atômica.** Nunca agrupar várias tarefas/mudanças não relacionadas em um único commit — isso vale especialmente para execução em worktrees/agentes: se uma sessão resolve várias tarefas, cada tarefa concluída gera seu **próprio** commit, na ordem em que foi concluída. Não acumular tudo num commit final "resumo".
