#!/usr/bin/env bash
# Stop hook: só notifica quando não há subagents/background tasks ainda em execução.
# Evita notificação falsa de "tarefa finalizada" quando o Stop é apenas o Claude
# principal devolvendo o controle enquanto um subagent em background continua rodando.
input="$(cat)"
running=$(echo "$input" | jq -r '[.background_tasks[]? | select(.status=="running" or .status=="pending")] | length' 2>/dev/null)

if [ "${running:-0}" -eq 0 ]; then
  notify-send 'Claude Code' 'Tarefa finalizada'
fi
