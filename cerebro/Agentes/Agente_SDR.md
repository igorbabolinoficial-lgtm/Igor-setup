---
projeto: Igor_Babolin
tipo: agente
papel: pre_venda
chave: sdr
conecta_com:
  - [[Igor_Babolin]] # Parte_de
  - [[Agente_Atendimento]] # Passa_para
---

# Agente SDR — Pré-venda

## Função
Primeiro contato com leads novos. Qualifica via score, faz follow-up, prepara handoff pro Atendimento quando o lead vira qualificado.

## Tipos de Tarefa
| Tipo | Descrição | Aprovação humana? |
|---|---|---|
| `qualificar_lead` | Atribui score IA 0-100 | ❌ interno |
| `follow_up` | Reengaja lead sem resposta em 24h | ✅ obrigatório |
| `boas_vindas` | Mensagem inicial pra novo lead | ✅ obrigatório |

## Cérebro
Hoje: score random (mock). Depois: Gemini com contexto do lead + Cérebro Obsidian.

## Sinapses
- **Parte_de:** [[Igor_Babolin]] — recebe ordens do Maestro
- **Passa_para:** [[Agente_Atendimento]] — quando lead converte
