# Igor Neural System

**Ativo Digital do Igor Babolin — Imobiliária Praia do Rosa.**
Ecossistema único: site público + dashboard operacional + rede de 7 agentes autônomos com Maestro IA.

---

## 🧠 Arquitetura em 1 minuto

```
                          ┌──────────────────────┐
                          │   PÚBLICO  (index)   │  ← clientes navegam catálogo
                          │   /  →  28 imóveis   │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   API REST (Express) │
                          │   13 grupos de rotas │
                          └──────────┬───────────┘
                                     │
        ┌───────────────┬────────────┼────────────┬─────────────┐
        │               │            │            │             │
   ┌────▼────┐    ┌─────▼─────┐  ┌───▼────┐  ┌────▼────┐  ┌─────▼──────┐
   │ SQLite  │    │ Catálogo  │  │ Igor   │  │ Cérebro │  │  IA        │
   │ igor.db │    │ 388 fotos │  │ Maestro│  │Obsidian │  │  Gemini    │
   │10 tabs  │    │  50 MB    │  │  IA    │  │  vault  │  │  2.0 Flash │
   └─────────┘    └───────────┘  └────┬───┘  └─────────┘  └────────────┘
                                      │
              ┌────────────┬──────────┼──────────┬─────────────┬────────────┐
              │            │          │          │             │            │
         ┌────▼─┐    ┌─────▼──┐  ┌────▼───┐  ┌───▼────┐   ┌────▼────┐  ┌────▼──────┐
         │ SDR  │    │Financ. │  │Designer│  │ Social │   │Pesquisa │  │Atendimento│
         └──────┘    └────────┘  └────────┘  └────────┘   └─────────┘  └───────────┘
                                                          │
                          ┌───────────────┐               │
                          │  DASHBOARD    │  ← Igor Babolin opera
                          │  /dashboard   │               │
                          │ Sala animada  ◄───────────────┘
                          └───────────────┘
```

---

## 📂 Estrutura de arquivos

```
igor-neural-system/
├── server.js                  Express bootstrap, wiring de 13 rotas
├── package.json
├── .env / .env.example
├── README.md                  ← você está aqui
├── igor.db                    SQLite (gerado em runtime)
│
├── db/
│   ├── schema.sql             10 tabelas em pt-BR
│   └── index.js               init + seed automático + helpers
│
├── routes/
│   ├── leads.js               CRUD + Kanban (/api/leads)
│   ├── agenda.js              Eventos próx N dias
│   ├── logs.js                Auditoria + 8 templates
│   ├── config.js              API keys mascaradas
│   ├── status.js              8 integrações
│   ├── ai.js                  Console Neural (Gemini)
│   ├── webhooks.js            n8n + Z-API entrada
│   ├── agentes.js             Status + fila de tarefas
│   ├── aprovacoes.js          Fila de aprovação humana
│   ├── cerebro.js             Reader do vault Obsidian
│   ├── briefing.js            Resumo diário do Igor
│   ├── imoveis.js             Catálogo (filtros + stats)
│   └── sistema.js             Saúde global + arquitetura
│
├── agentes/
│   ├── base.js                executarTarefa + heartbeat
│   ├── maestro.js             ★ Igor: pensar() + pensarComIA() + cron
│   ├── sdr.js
│   ├── financeiro.js
│   ├── designer.js
│   ├── social.js
│   ├── pesquisa.js            (lê tabela imoveis)
│   └── atendimento.js
│
├── briefing.js                Cron 08:00 + re-migração 03:00
├── migrator.js                Scraper sitemap → tabela imoveis + fotos
├── extrator.js                Versão antiga (mock 152 imóveis)
│
└── public/
    ├── index.html             ← Site público da imobiliária
    ├── dashboard.html         ← Dashboard operacional do Igor
    └── assets/imoveis/
        └── <id>/<n>.jpg       388 fotos, 50 MB
```

---

## 🤖 Rede de Agentes

| Chave | Nome | Tipos de tarefa | Cérebro |
|---|---|---|---|
| **maestro** | Igor (Maestro) | orquestrar, heartbeat | Heurística + Gemini |
| **sdr** | SDR | qualificar_lead, follow_up, boas_vindas | Mock + score random |
| **financeiro** | Financeiro | classificar_tx, relatorio_dre | Regex |
| **designer** | Designer | gerar_arte, editar_imagem | Mock |
| **social** | Social | gerar_post, agendar_post, responder_dm | Mock |
| **pesquisa** | Pesquisa | pesquisar_mercado, sugerir_imovel, monitorar_concorrencia | Tabela `imoveis` |
| **atendimento** | Atendimento | atender_cliente, documentacao_pos | Mock |

### Como o Igor decide

```
A cada 15s:    pensar()        ← if/else heurístico (gratuito)
A cada 5min:   pensarComIA()   ← Gemini analisa estado, retorna JSON com decisões
```

Sensíveis (`follow_up`, `responder_dm`, `boas_vindas`) **vão pra fila de aprovação humana** antes de executar — Igor nunca dispara mensagem real pro cliente sem você aprovar.

---

## ⏰ Crons ativos

| Quando | O quê |
|---|---|
| `*/15 * * * * *` | Igor heurístico processa fila |
| `*/5 * * * *`   | Igor pensa com Gemini (se chave configurada) |
| `0 8 * * *`     | Briefing matinal automático |
| `0 3 * * *`     | Re-migração do catálogo (atualiza preços/novos imóveis) |

---

## 🚀 Como rodar

```bash
cp .env.example .env
# Preencha as chaves (mínimo: PORT, OBSIDIAN_PATH; opcional: GEMINI_API_KEY pra IA real)

npm install
npm start
# → http://localhost:3003/            (público)
# → http://localhost:3003/dashboard   (operacional)
```

---

## 📡 Endpoints principais

```
GET  /api/sistema/saude          → Status global do ecossistema
GET  /api/sistema/arquitetura    → Mapa das camadas

GET  /api/imoveis?tipo=&bairro=&q=&preco_min=&preco_max=
GET  /api/leads/kanban
GET  /api/agentes
POST /api/agentes/tarefas
POST /api/agentes/pensar-ia      → força IA agora
GET  /api/aprovacoes
POST /api/aprovacoes/aprovar-todas
POST /api/briefing/agora
POST /api/ai/consulta            → Console Neural (Gemini)
```

---

## 🔑 Variáveis de ambiente

| Chave | Pra quê |
|---|---|
| `PORT` | Porta do servidor (default 3003) |
| `OBSIDIAN_PATH` | Caminho do vault — Cérebro do Igor |
| `GEMINI_API_KEY` | Liga IA real (sem isso, fallback heurístico) |
| `ANTHROPIC_API_KEY` | Plug pronto, ainda não usado |
| `ZAPI_INSTANCIA` / `ZAPI_TOKEN` | WhatsApp Z-API (mock até preencher) |
| `N8N_WEBHOOK_SECRET` | Validação dos webhooks do n8n |
| `PERSONA_SDR` | Texto de persona enviado pro Gemini |

Também podem ser salvas em **Configurações API** dentro do dashboard (mais conveniente).

---

## 🗺️ Convenções

- **Idioma:** UI/labels/status enums em **pt-BR snake_case** (`novo_lead`, `em_atendimento`, `convertido`)
- **Código:** identificadores em inglês (convenção universal)
- **Cérebro = Obsidian**: source of truth de contexto. Igor lê markdown do vault pra decidir.
- **Aprovação humana** é compulsória pra qualquer ação que sai da empresa (mensagem ao cliente).
- **Mock honesto:** agentes que ainda não têm integração real retornam dados marcados (`fonte: 'mock'`).

---

## 🧪 Saúde rápida

```bash
curl http://localhost:3003/api/sistema/saude
```

Retorna JSON com: heartbeat do Igor, modo IA ativo, totais de leads/imóveis/tarefas, status do Cérebro, status das chaves, última execução de cada cron.
