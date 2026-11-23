# Histórico de sessões e relatório mensal cruzado com lições

## Por quê

O `/insights` nativo sobrescreve o relatório a cada rodada, analisa só parte das sessões (50 de 122 em 23/11) e não lê os logs de auditoria. No relatório de 23/11 o eduka (15 sessões, 20 logs de auditoria) aparece uma vez. E o Claude Code apaga conversas com mais de 30 dias. O usuário quer um "insights próprio": histórico por ano/mês/projeto, relatório mensal em texto cruzado com as lições auditadas, anual sob demanda, filtro por projeto e busca de tarefa — sem viés de tamanho de sessão e sem precisar lembrar de guardar nada.

## Objetivos

- Toda sessão vira uma ficha antes de a conversa ser apagada, sem ação do usuário e sem custo de tokens.
- Relatório mensal por projeto e geral, a partir dos logs de auditoria (fonte principal) e das fichas (complemento), cruzado com as lições.
- Anual a partir dos mensais; filtro por projeto (mês ou ano); busca de tarefa.
- Cada projeto e cada tarefa aparecem, independente do tamanho da conversa.

## Não objetivos

- Usar o `/insights` como fonte.
- Guardar conversas completas (usuário escolheu ficha: opção A).
- Escrever lições: continuam só via `/revisar-logs`, com aprovação.

## Anti-objetivos

- Projeto relevante sumir do relatório por ter sessões curtas ou poucas.
- Uma sessão com texto colado gigante dominar o custo do relatório.

## Abordagens consideradas

Arquivamento das conversas: A) ficha por sessão extraída sem modelo — **escolhida**; B) cópia completa compactada (~300 MB/ano, relatório mais caro); C) as duas. Geração: hook arquiva + comando escreve (escolhida antes, mantida).

Busca: `grep` sobre fichas e logs + índice de palavras-chave escrito no relatório mensal + claude-mem como segunda fonte, se instalado — **as três, pedido do usuário**.

## Desenho

### Pasta `~/.claude/historico/`

```
historico/
  estado.json                          # mtime de cada conversa arquivada, projetos vistos, último aviso
  2026/
    resumo.md                          # anual, sob demanda
    11/
      resumo.md                        # geral do mês
      indice.md                        # uma linha por tarefa, com palavras-chave
      eduka/                           # nome da pasta do projeto ("_home" para o home)
        resumo.md                      # mensal do projeto
        sessoes/<session_id>.json      # ficha
```

### Ficha (gerada por código, sem modelo)

`session`, `titulo` (o `ai-title` do Claude Code), `projeto`, `projeto_path`, `inicio`, `fim`, `ativo_min` (soma dos intervalos entre registros, cada um limitado a 10 min), `mensagens` (só as digitadas pelo usuário: sem tool results, avisos de sistema, notificações; comandos viram `/nome args`; cada uma cortada em 2000 caracteres), `arquivos` editados, `ferramentas` (contagem), `erros_ferramenta`, `commits`, `log` (log de auditoria cujo texto contém o id da sessão), `fonte_mtime`.

### Script `hooks/historico.mjs` (TS, só biblioteca padrão)

- Hook `SessionStart` e `SessionEnd`: arquiva as conversas novas ou alteradas de `<claude>/projects/*/*.jsonl` (subagents ficam de fora). No `SessionStart`, se há mês fechado com fichas e sem `resumo.md` (ou com fichas mais novas que o resumo), injeta um aviso para oferecer `/relatorio AAAA-MM` — no máximo uma vez por dia.
- `historico.mjs arquivar` — o mesmo, à mão.
- `historico.mjs mes AAAA-MM [filtro]` — digest compacto do mês por projeto: sessões (data, minutos ativos, título, mensagens cortadas em 500 caracteres, arquivos, erros, commits, log) e logs de auditoria do mês (de todos os projetos vistos, só os da raiz de `.claude/logs/`), com `revisao` e `status`. É a entrada do relatório.
- `historico.mjs buscar <termos...>` — procura nas fichas, nos `indice.md` e nos logs; ranqueia por termos encontrados, ocorrências e bônus quando o termo está no título ou nome do arquivo.
- `historico.mjs pendentes` — meses fechados sem relatório atualizado.

### Skill `/relatorio`

- `/relatorio` — arquiva e gera os meses pendentes (ou o mês corrente, parcial, se pedido).
- `/relatorio AAAA-MM [projeto]`, `/relatorio AAAA [projeto]` — mensal ou anual, opcionalmente filtrado (`dataviva` casa com todos os caminhos que contêm `dataviva`).
- `/relatorio busca <descrição>` — expande a descrição em sinônimos, roda `buscar`, consulta o claude-mem se disponível, lê só os 2–3 melhores e responde data, projeto, o que foi feito e o caminho do log. Se nada bate, diz que não achou.
- Mensal: uma seção por projeto com sessão ou log no mês, ordenada por número de tarefas (logs + sessões sem log), nunca por tamanho. Logs lidos nas seções Pedido, Hipóteses, Decisões, Correções. Cruzamento com lições: lições cuja Origem cita um log do mês; correções do mês que repetem uma lição já existente (sinal de que a lição não funcionou); logs ainda `revisao: pendente` (sugere `/revisar-logs`); candidatos a lição apenas apontados. Comparação com o mês anterior quando existir. Escreve `indice.md` com palavras-chave e sinônimos por tarefa.
- Anual: lê os `resumo.md` mensais; volta ao digest só para mês sem resumo.

### Instalador

`FILES` ganha `hooks/historico.mjs` e `skills/relatorio/SKILL.md`; registra o hook em `SessionStart` e `SessionEnd` (timeout 60); `uninstall` remove hook e skill e **nunca** `historico/`.

## Deixado para o construtor

- Formato exato dos `resumo.md`.
- Tolerar campos ausentes nas conversas (formato interno do Claude Code).
