---
projeto: Igor_Babolin
tipo: agente
papel: inteligencia_mercado
chave: pesquisa
conecta_com:
  - [[Igor_Babolin]] # Parte_de
  - [[Agente_SDR]] # Alimenta
---

# Agente Pesquisa — Inteligência

## Função
Vasculha catálogo de imóveis, sugere matches pra leads, monitora mercado e concorrência.

## Tipos de Tarefa
| Tipo | Descrição |
|---|---|
| `pesquisar_mercado` | Stats agregadas (preço médio, distribuição por tipo) |
| `sugerir_imovel` | Top 5 imóveis por orçamento |
| `monitorar_concorrencia` | (mock) acompanhamento de outras imobiliárias |

## Cérebro
Consulta direto a tabela `imoveis` no SQLite (28 propriedades reais migradas do site).

## Sinapses
- **Parte_de:** [[Igor_Babolin]]
- **Alimenta:** [[Agente_SDR]] — fornece imóveis sugeridos pra o SDR mandar pro lead
