---
projeto: Igor_Babolin
tipo: dna_operacional
data: 2026-05-16
origem: Igor humano (briefing via Levi)
conecta_com:
  - [[Igor_Babolin]] # Define_DNA_de
  - [[Agente_SDR]] # Orienta
  - [[Agente_Social]] # Orienta
  - [[Agente_Atendimento]] # Orienta
  - [[Agente_Designer]] # Orienta
---

# Visão Igor — Operação Ideal da Imobiliária

> Documento que reflete como o **Igor humano** quer que a imobiliária opere quando 100% automatizada. Norte estratégico pra todos os agentes — sempre que um agente decidir algo, deve perguntar: "isso aproxima a operação dessa visão?"

## Princípio fundamental

A imobiliária Igor Babolin atende **padrão lifestyle na Praia do Rosa** — não é venda commodity. Cada lead merece resposta rápida, qualificada e personalizada. Cada cliente fechado vira potencial up-sell, indicação ou recomprador. O Igor humano só entra na conversa **quando o lead já está qualificado E quente** — automação cuida do resto.

## Arquitetura de 6 agentes (visão Igor)

### 1. Captação de Leads (Instagram / WhatsApp)

**Função:** Garante que NENHUM lead se perde entre canais.

**Skills:**
- Integração Instagram (DMs + comentários) — captação automática
- Qualificação inicial rápida (orçamento? "pra morar ou investir"?)
- Encaminhamento ao pipeline (Kommo / CRM)
- Respostas automáticas FAQ (financiamento, região, regulamentos)

**Diferencial:** velocidade de resposta + qualificação cirúrgica antes de jogar pro Comercial.

### 2. Comercial / Pré-Venda

**Função:** Cuida do pipeline e move o lead até o fechamento sem o Igor humano precisar tocar em coisa repetitiva.

**Skills:**
- Pipeline CRM (Kommo, Pipedrive, HubSpot)
- Agendamento de visitas via Google Calendar
- Envio de apresentações personalizadas por WhatsApp / email / link único
- Follow-up automatizado (lead sumido > 24h, check-in pós-visita)
- Coleta de documentação inicial (RG, CPF, comprovante renda)

**Diferencial:** Igor humano só interage com leads "quentes" (score IA ≥85 + ação `agendar_call` ou `mandar_proposta`).

### 3. Atendimento Online 24/7

**Função:** Filtro inteligente entre cliente curioso e cliente sério.

**Skills:**
- Chatbot treinado em FAQ + região (bairros Rosa, Ibiraquera, Garopaba) + regulamentos locais + financiamento + detalhes técnicos de imóveis e contratos
- Detecção de dúvida NÃO respondida → escalonamento automático pra humano
- Gestão de agenda dos corretores (só chama "gente" quando realmente necessário)

**Diferencial:** humano só é chamado quando IA detecta limite de competência.

### 4. Pós-Venda / Relacionamento

**Função:** Cliente fechado vira ativo recorrente, não some.

**Skills:**
- Lembretes automáticos (assinatura, renovação, vencimento aluguel)
- Pesquisa de satisfação (NPS, link pra avaliação Google)
- Up-sell de novos imóveis ("seu perfil combina com esse lançamento")
- Suporte a boletos / documentos (integração ERP)

**Diferencial:** memória persistente do cliente — "Maria já visitou 3 imóveis, prefere vista mar, filhos pequenos, esposa concorda".

### 5. Dashboard / Relatórios

**Função:** Igor humano sabe TUDO em 1 olhada.

**Skills:**
- Relatórios automáticos: captação, conversão, imóveis mais buscados, tempo médio de venda, desempenho dos corretores
- Alertas de oportunidades: imóveis sem visita em X dias, leads sem resposta há Y dias

**Diferencial:** alertas proativos (push Telegram) — Igor não precisa ENTRAR no dashboard pra ver problema, sistema avisa.

### 6. Agente pra Proprietários

**Função:** Quem vende imóvel pela Igor acompanha tudo em tempo real, sem ligar pra perguntar status.

**Skills:**
- Portal automático (status visitas, propostas recebidas, documentação)
- Notificações automáticas WhatsApp / email

**Diferencial:** transparência total pro proprietário → confiança → mais imóveis na carteira.

## Extras possíveis

- **Integração portais** (Zap Imóveis, VivaReal, OLX) — sincroniza catálogo
- **Programação automática de anúncios** (Instagram, Google Ads)
- **Compliance / antifraude de documentos** (validação CPF, comprovantes)

## Skills sob demanda (palavra-chave ativa)

O Igor humano quer que algumas skills fiquem **adormecidas** e só sejam acionadas por palavra-chave — pra **não consumir contexto** desnecessariamente. Lista que ele pediu:

| Skill | Quando dispara | Output |
|---|---|---|
| **Skill Creator** | "cria skill X" | Estrutura nova skill no sistema com prompt + matchers |
| **Prompt + Design** | "monta prompt pra X" | Prompt estruturado pronto pra usar em outro agente |
| **PDF** | "gera PDF de X" | Documento PDF (proposta, dossiê do imóvel) |
| **XLSX** | "planilha de X" | Excel (relatório financeiro, lista de imóveis) |
| **PPTX** | "apresentação de X" | Slides PowerPoint (apresentação de imóvel pro cliente) |
| **DOCX** | "documento de X" | Word (contrato, ata, proposta formal) |
| **Contratos** | "contrato de X" | Modelo de contrato preenchido com dados do lead/imóvel |
| **Find Skills** | "que skill faz X" | Lista skills disponíveis que atendem a necessidade |

**Princípio**: skills dormem, são despertadas por matcher (regex/keyword/intent). Cada execução vira registro em `execution_logs`. Curador LLM (futuro) observa logs e propõe **novas skills automaticamente** baseado em padrões de uso real.

## Memória do cliente

Igor mencionou "avançar nas memórias". A memória atual do Igor sistema:
- `leads.tags_ia` — tags geradas pela IA na qualificação
- `leads.segmento` — investidor / morar / veranear / urgente / longo_prazo
- Timeline (logs filtrados por `lead_id`)

O que **falta** pra ser memória de verdade:
- **Resumo evolutivo** por lead — "o que sabemos hoje sobre Maria" em 1 parágrafo, atualizado a cada interação
- **Embeddings** (futuro) — busca semântica "leads parecidos com Maria"
- **Sugestões cross-lead** — quando aparece lead novo similar a um vendido, push pro corretor

## Onde estamos hoje vs onde precisamos chegar

| Função visão Igor | Status no sistema |
|---|---|
| Captação Insta + WhatsApp | Chatbot site OK · Insta API e WhatsApp Evolution faltam |
| Comercial pipeline CRM | Pipeline interno SQLite OK · CRM externo (Kommo?) falta |
| Agendamento Google Calendar | Agenda interna OK · Google Calendar API falta |
| Atendimento 24/7 + escalonamento | Chatbot público OK · escalonamento automático falta |
| Pós-venda lembretes + NPS + up-sell | Nada implementado |
| Portal Proprietários | Nada implementado |
| Relatórios automáticos | Briefing 07:00 + Relatório semanal OK · evoluir |
| Skills sob demanda (PDF/XLSX/PPTX/etc) | Nada implementado |
| Memória evolutiva do cliente | Tags + segmento + timeline · resumo evolutivo falta |

---

## 🔗 Conexões

- Hub central: [[Igor_Babolin]]
- Orienta: [[Agente_SDR]] [[Agente_Social]] [[Agente_Atendimento]] [[Agente_Designer]] [[Agente_Pesquisa]] [[Agente_Financeiro]]

*Esta nota é o DNA operacional vivo. Atualizar sempre que Igor humano refinar a visão. O `contextoDNA()` em `routes/cerebro.js` injeta este documento (junto com `Igor_Babolin.md` hub) nos prompts dos agentes, garantindo que TODOS operem alinhados.*
