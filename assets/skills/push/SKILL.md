---
name: push
description: Commita o que não foi commitado no repositório atual, em commits atômicos no padrão Conventional Commits, e faz push para a branch atual. Só roda quando o usuário digita /push.
disable-model-invocation: true
---

# /push

Commita as mudanças pendentes do repositório da pasta atual e envia para a branch atual. O usuário pediu isso ao digitar `/push`: não pergunte de novo se deve commitar ou fazer push, a não ser nos casos de parada abaixo.

## 1. Situação

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git log --oneline -5
```

- Fora de um repositório git: diga isso e pare.
- `HEAD` destacado (branch vazia), merge, rebase ou cherry-pick em andamento: diga o estado e pare.
- Nada a commitar: pule para o passo 4 (pode haver commits locais ainda não enviados).
- `<pasta>` com sub-repositórios (workspace multi-repo): trate só o repositório da pasta atual e diga quais outros têm mudanças (`git -C <sub> status --short`), sem mexer neles.

## 2. Agrupar em commits atômicos

Leia o diff (`git diff`, `git diff --staged` e o conteúdo dos arquivos novos) e separe as mudanças por tarefa: **um commit = uma tarefa**. Mudanças não relacionadas nunca vão no mesmo commit. Se a sessão tem log em `.claude/logs/`, use o pedido e as rodadas dele para nomear as tarefas.

Não commite, e avise no relatório:
- arquivos com cara de segredo: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, tokens ou chaves visíveis no diff;
- arquivos grandes ou gerados que não deveriam estar no git (build, `node_modules`, dumps) e que o `.gitignore` não pega;
- arquivos que o usuário claramente ainda está editando no meio (conflito `<<<<<<<`, código quebrado de propósito).

Arquivos já staged pelo usuário: respeite a seleção dele como um dos commits.

## 3. Commitar

Para cada grupo, na ordem em que as tarefas foram feitas:

```bash
git add -- <arquivos do grupo>
git commit --no-gpg-sign -m "<título>" -m "<corpo>"
```

Mensagem:
- `<tipo>(<escopo opcional>): <descrição>` com tipo em `feat|fix|docs|style|refactor|perf|test|build|ci|chore`;
- título até 72 caracteres, imperativo, minúsculo, sem ponto final, no idioma dos commits recentes do repo;
- corpo opcional, no máximo 3 bullets `- ...`, o quê e não como;
- **sem** linha `Co-Authored-By` nem outro trailer de autoria;
- confira com `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?: .+` antes de rodar.

Se um arquivo mistura duas tarefas e não dá para separar sem `git add -p` interativo, commite junto com a tarefa principal e registre o desvio no relatório.

Nunca use `--no-verify`, `--amend` em commit já enviado, nem reescreva histórico. Se um hook de pre-commit falhar, mostre o erro, corrija se for da mudança, e crie um commit **novo**.

## 4. Push

```bash
git push                                   # com upstream
git push -u origin <branch>                # sem upstream (rev-parse @{u} falha)
```

- Remoto diferente de `origin` ou vários remotos sem upstream: pergunte para qual.
- Push rejeitado (branch remota à frente): **não force**. Mostre `git log --oneline HEAD..@{u}` e pergunte se faz `git pull --rebase` antes de tentar de novo.
- Nunca `--force` nem `--force-with-lease` sem o usuário pedir com essas palavras.

## 5. Relatório

- branch e remoto;
- cada commit: hash curto + título;
- arquivos deixados de fora e por quê;
- resultado do push (o intervalo `antigo..novo` que o git mostra) ou o motivo de não ter feito.
