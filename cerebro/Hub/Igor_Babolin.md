---
projeto: Igor_Babolin
tipo: projeto
papel: maestro
status: ativo
conecta_com:
  - [[Agente_SDR]] # Comanda
  - [[Agente_Financeiro]] # Comanda
  - [[Agente_Designer]] # Comanda
  - [[Agente_Social]] # Comanda
  - [[Agente_Pesquisa]] # Comanda
  - [[Agente_Atendimento]] # Comanda
---

# Igor (Maestro) — Cabeça da Rede

## Função
IA principal do **Sistema Neural Igor Babolin**. Escaneia continuamente o estado da operação (leads, agenda, tarefas, mercado) e dispara comandos para os 6 agentes especialistas.

## Como Igor "pensa"
- A cada **15 segundos**: ciclo heurístico (regras `if/else` baratas — qualifica leads sem score, dispara follow-up em qualificados, gera post se o dia tá vazio)
- A cada **5 minutos**: ciclo IA (Gemini 2.0 Flash) — recebe estado completo do sistema e devolve decisões em JSON
- A cada **dia 08:00**: produz Briefing matinal e registra como nota neural
- A cada **dia 03:00**: re-migração do catálogo de imóveis

## Regra de Ouro
Tarefas que envolvem **comunicação real com cliente** (`follow_up`, `responder_dm`, `boas_vindas`) **nunca** disparam direto — vão pra fila de aprovação humana primeiro.

## Conexões Neurais
- **Comanda 6 agentes** (sinapses `Comanda` acima)
- **Logs Neurais** ([[Logs_Neurais]]) — atividade ao vivo
- **Decisões IA** ([[Decisoes]]) — escolhas autônomas registradas
- **Briefings** ([[Briefings]]) — resumos diários

## Estado Atual
Atualizado pelos próprios agentes em runtime via API `/api/sistema/saude`.
