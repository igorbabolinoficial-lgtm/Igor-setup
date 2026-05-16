---
projeto: Igor_Babolin
tipo: agente
papel: financas
chave: financeiro
conecta_com:
  - [[Igor_Babolin]] # Parte_de
---

# Agente Financeiro

## Função
Categoriza transações bancárias, monta DRE mensal, alerta sobre comissões e contas a pagar.

## Tipos de Tarefa
| Tipo | Descrição |
|---|---|
| `classificar_tx` | Categoriza transação (imóvel, transporte, marketing, comissão, etc) via regex |
| `relatorio_dre` | Compila DRE do período |

## Cérebro
Regex sobre descrição da transação. Próximo passo: usar Gemini pra classificação contextual.
