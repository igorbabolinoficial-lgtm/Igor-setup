---
projeto: Igor_Babolin
tipo: agente
papel: pos_venda
chave: atendimento
conecta_com:
  - [[Igor_Babolin]] # Parte_de
  - [[Agente_SDR]] # Recebe_de
---

# Agente Atendimento — Pós-venda

## Função
Cuida do cliente depois que o lead vira venda: documentação, vistoria, dúvidas, fechamento de contrato.

## Tipos de Tarefa
| Tipo | Descrição |
|---|---|
| `atender_cliente` | Resposta a dúvidas pós-venda |
| `documentacao_pos` | Etapas de documentação (assinatura, escritura, vistoria) |

## Cérebro
**Mock por enquanto.** Próximo passo: templates configuráveis + integração WhatsApp pra confirmar etapas.

## Sinapses
- **Parte_de:** [[Igor_Babolin]]
- **Recebe_de:** [[Agente_SDR]] — recebe leads convertidos pra fechar
