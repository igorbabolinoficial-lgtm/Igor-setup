---
projeto: Igor_Babolin
tipo: agente
papel: criacao_visual
chave: designer
conecta_com:
  - [[Igor_Babolin]] # Parte_de
  - [[Agente_Social]] # Alimenta
---

# Agente Designer

## Função
Gera artes para posts, carrosséis, anúncios e materiais visuais do Instagram.

## Tipos de Tarefa
| Tipo | Descrição |
|---|---|
| `gerar_arte` | Cria peça nova (briefing + formato) |
| `editar_imagem` | Ajusta peça existente |

## Cérebro
**Mock por enquanto.** Próximo passo: integração com API de geração de imagem (DALL-E, Stable Diffusion, ou Gemini Image).

## Sinapses
- **Parte_de:** [[Igor_Babolin]]
- **Alimenta:** [[Agente_Social]] — entrega artes pro Social usar nos posts
