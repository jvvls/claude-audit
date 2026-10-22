---
session: <session_id>
date: AAAA-MM-DD
projeto: <pasta onde a sessão começou>
repos: []
tipo: feature | bugfix | diagnóstico | migração | refactor
status: em-andamento | concluído | pausado
revisao: pendente        # humano troca para: ok | erro-registrado | descartado
# custo (opcional): o humano preenche lendo o /usage no fim de cada sessão
esforco: {}              # ex.: {spec: xhigh, construcao: xhigh, ajustes: medium, commit: low}
limite_primeira_entrega: # % da janela de 5 h quando a primeira versão ficou pronta
rodadas_correcao:        # pedidos de correção até o aceite
limite_no_aceite:        # % da janela de 5 h no aceite
sessoes:                 # sessões (/clear) usadas na tarefa
---

# <título curto da tarefa>

## Pedido
<o que foi pedido, nas palavras do usuário, resumido>

## Hipóteses e diagnóstico
<!-- Uma linha por hipótese, na ordem em que surgiram. Inclua as descartadas: elas são o que mais ensina. -->
| # | Hipótese | Evidência | Resultado |
|---|---|---|---|
| H1 | ... | arquivo:linha / comando / número | confirmada · descartada · não testada |

**Causa raiz:** <só preencha se confirmada por evidência reproduzível; senão escreva "não confirmada" e o que falta>

## Decisões
<!-- Fonte de cada uma: pedido · doc · código (1 lugar) · padrão (vários lugares) · referência · inferência · usuário respondeu -->
- <decisão> (fonte: ...)

## Regras assumidas sem confirmação
- <regra> (por que assumi; quem deveria confirmar)

## Mudanças
- `repo/caminho/arquivo` — <o quê, em uma linha>

## Validação
- <repo>: `<comando>` → baseline: ... · depois: ... (novas falhas vs. pré-existentes)

## Correções durante a sessão
<!-- Onde errei ou fui corrigido: o que eu disse/fiz, o que era o certo, por que errei. -->
- 

## Questões em aberto
- 
