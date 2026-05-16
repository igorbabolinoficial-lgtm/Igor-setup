---
projeto: Igor_Babolin
tipo: agente
papel: conteudo_redes
chave: social
conecta_com:
  - [[Igor_Babolin]] # Parte_de
  - [[Agente_Designer]] # Depende_de
---

# Agente Social

## Função
Cria copy de posts, agenda no Instagram/LinkedIn, responde DMs.

## Tipos de Tarefa
| Tipo | Descrição | Aprovação humana? |
|---|---|---|
| `gerar_post` | Cria texto + sugestão de tema | ❌ |
| `agendar_post` | Coloca na agenda do dia | ❌ |
| `responder_dm` | Responde mensagem direta | ✅ obrigatório |

## Cérebro
Texto mock + integração futura com Z-API (WhatsApp) e Meta Graph API (IG/FB).

## Sinapses
- **Parte_de:** [[Igor_Babolin]]
- **Depende_de:** [[Agente_Designer]] — precisa da arte pra o post
