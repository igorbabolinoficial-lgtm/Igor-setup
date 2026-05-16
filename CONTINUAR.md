# Igor Neural System — Onde paramos (sessão 2026-05-09 → 10)

## ✅ Entregue hoje (10 features + 5 ciclos proativos da sessão anterior)

### Wrapper IA único (`agentes/ia.js`) — base de tudo
- `gerarTexto(prompt)` tenta Gemini → fallback Anthropic Claude.
- `temAlgumLLM()` flag rápido pra checar disponibilidade.
- Anthropic SDK instalado: `@anthropic-ai/sdk`.

### Agentes ficaram inteligentes (não mais mock)
- **SDR** (`agentes/sdr.js`): `qualificar_lead` agora gera **score + segmento + tags** via IA. Segmentos: `investidor / morar / veranear / urgente / longo_prazo`. `follow_up` gera mensagem real.
- **Social** (`agentes/social.js`): `gerar_post` produz **headline + copy + hashtags** reais com contexto do imóvel. `responder_dm` gera resposta IA contextualizada com lead.
- **Designer** (em `agentes/proativo.js → designerPreproducao`): cada criativo agora vem com `headline_ig`, `copy_dm`, `copy_post`, `carrossel[5]`, `hashtags[6]` via IA. Status `rascunho_ia` ou `rascunho_fallback`.

### Novos ciclos cron proativos (em `agentes/proativo.js`)
- **Relatório semanal** seg 07:30 → `Briefings/Semanal/Relatorio_Semanal_*.md` com horas economizadas + análise IA
- **Backup diário** 02:00 → `00_Backups/igor.db.AAAA-MM-DD.bak` no vault, retenção 14 dias
- **TTL aprovações** de hora em hora → marca pendentes >7d como `status=expirada`

### CRM — leads ficaram navegáveis
- `GET /api/leads/:id/timeline` → agrega logs + tarefas + aprovações + agenda do lead
- `POST /api/leads/:id/arquivar` → soft-delete (coluna `arquivado`)
- Filtros novos: `?incluir_treino=true`, `?incluir_arquivados=true`, `?segmento=`, `?tag=`
- **Default agora esconde leads de treino e arquivados** (Kanban + lista)
- Resposta inclui `tags_ia[]`, `segmento`, `eh_treino`, `arquivado`

### Migrations idempotentes (`db/index.js`)
Adicionadas (ALTER TABLE if not exists):
- `leads.tags_ia` TEXT (JSON array)
- `leads.segmento` TEXT
- `leads.arquivado` INTEGER DEFAULT 0
- `aprovacoes.expirada_em` TEXT

### Chatbot público (mais visível pro cliente)
- Bolinha 💬 no canto inf-direito do `index.html` (site público)
- Endpoint `POST /api/ai/publica` (sem segredo, com **rate limit 20 req/min/IP**)
- Detecta nome+telefone na conversa e **cria lead automaticamente** (`origem='site_chat'`)
- Conversa contextualizada com catálogo (n imóveis, faixa de preço)

### Cérebro Obsidian — grafo conectado
- Cada criativo conecta a `[[Tipo_X]]` + `[[Bairro_Y]]` (no corpo, não só YAML)
- Hubs gerados em `10_Estrategia/Tipos/` e `10_Estrategia/Bairros/`
- Vault `Igor_Babolin_Brain` separado de `Mente Milhonaria` (intacto)

---

## 🔑 ÚNICO passo pra ativar 100% das features hoje desligadas

**Plugar pelo menos uma chave** (Configurações no dashboard ou `.env`):
- `GEMINI_API_KEY` — https://aistudio.google.com/apikey (gratuito)
- `ANTHROPIC_API_KEY` — https://console.anthropic.com (pago, mas vira fallback)

Quando uma entrar:
- 28 criativos do Designer reescrevem com copy real (no próximo bootstrap ou 06:30)
- Próximo `gerar_post` produz copy de verdade
- Qualificação de lead ganha tags + segmento reais
- Chatbot público conversa de verdade
- Relatório semanal (segunda 07:30) tem análise IA

---

## 🚧 Mocks ainda existentes — **decisões de produto faltando**

Pendentes pra próxima sessão (cada um precisa de uma escolha sua antes de implementar):

| Mock | Decisão necessária |
|---|---|
| **Designer `gerar_arte` (imagem real)** | Qual API? Gemini Image / DALL-E / Bannerbear / Placid / templates Canva? |
| **Atendimento pós-venda** | Qual fluxo? Vistoria? Contrato? Checklist de documentação? |
| **Financeiro (extrato real)** | Qual banco/integração? Inter API / Nubank / Pluggy / OFX manual? |
| **Notificação WhatsApp pro Igor humano** | Configurar Z-API (`zapi_instancia` + `zapi_token`) e definir gatilhos |

---

## 📁 Mapa rápido de arquivos modificados/criados hoje

**Novos:**
- `agentes/ia.js` (wrapper LLM unificado)
- `CONTINUAR.md` (este arquivo)

**Modificados:**
- `agentes/social.js`, `agentes/sdr.js`, `agentes/proativo.js`
- `db/index.js` (migrations)
- `routes/leads.js` (filtros + timeline + arquivar)
- `routes/ai.js` (chatbot público + rate limit)
- `public/index.html` (bolinha de chat)
- `briefing.js` (07:00 + hipóteses Gemini)
- `routes/briefing.js` (suporte async)
- `server.js` (plug do `proativo.iniciar()`)

**Vault Obsidian (Igor_Babolin_Brain):**
- `Agentes/Designer/criativos/*.md` (28 criativos com hub links no corpo)
- `10_Estrategia/Tipos/Tipo_*.md` (5 hubs por tipo)
- `10_Estrategia/Bairros/Bairro_*.md` (1 hub, mais virão conforme catálogo crescer)
- `00_Backups/igor.db.2026-05-10.bak`
- `Logs_Neurais/Pesquisa_de_Mercado_*.md` (snapshot horário)

---

## 🚀 Onde pegar de volta amanhã

**Opção A — Plugar API key + validar tudo end-to-end** (mais rápido, mostra o sistema completo)
1. Configurar `GEMINI_API_KEY` no dashboard
2. Forçar regeneração: `curl -X POST http://localhost:3003/api/briefing/agora` + reiniciar pra rodar designer/social bootstrap com IA
3. Abrir Obsidian e ver os criativos com copy real + relatório semanal

**Opção B — Atacar um dos 4 mocks pendentes** (precisa decisão antes)
- Pegar 1 da tabela acima e planejar implementação

**Opção C — Mais melhorias** (não foram revisadas hoje)
- Notificação ativa pro Igor (WhatsApp) — precisa Z-API
- Painel "Próximos passos" pro Igor humano (só agente faz; Igor humano não vê o que ele tem que fazer)
- Sistema de tags manuais (além das IA)
- Dashboard mostrar timeline visual do lead

---

## 🖥️ Estado do servidor

Rodando em http://localhost:3003 (background, vai continuar overnight pros crons).
- Backup 02:00 ✅
- Briefing 07:00 ✅
- Re-migração 03:00 ✅
- Pesquisa horária ✅
- Designer 06:30 / Social 06:00 / Modo treino /6h ✅

Se quiser parar antes de dormir: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3003 -State Listen).OwningProcess -Force`
