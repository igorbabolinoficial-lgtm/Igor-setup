# Pendências Igor — Estado em 2026-05-16 (final do dia)

> Sistema em produção em **https://babolin.tech** rodando na VPS dedicada `2.24.103.7` (Coolify v4.0.0).
> Deploys automáticos: eu disparo via API quando pusho commit. Você só vê o resultado.

## Tarefas que precisam de você (5 itens, ordem por valor)

| # | Item | Tempo | Onde fazer |
|---|---|---|---|
| 1 | Criar `@Igor_Babolin_bot` no BotFather + setar `IGOR_BOT_TOKEN` no Coolify | 2 min | Telegram → @BotFather → /newbot |
| 2 | Pegar `GROQ_API_KEY` nova (rotacionar a que vazou) + atualizar no Coolify | 1 min | console.groq.com/keys |
| 3 | Criar `ELEVENLABS_API_KEY` com permissões TTS+Models+Voices Read+User Read + setar no Coolify | 2 min | elevenlabs.io |
| 4 | Tornar `Igor-setup` privado de novo + configurar GitHub App no Coolify | 5 min | github.com/igorbabolinoficial-lgtm/Igor-setup/settings |
| 5 | (Externo) Charles destravar Bad Gateway na Evolution API | bloqueio | Sessão Charles Nobre |

### Como ativar o bot Telegram (passo 1 em detalhe)

1. Telegram → `@BotFather` → `/newbot`
2. Nome: `Igor Babolin Neural`
3. Username: tenta `igor_babolin_bot` (ou variante)
4. Copia o token (formato `1234567890:ABC...`)
5. Pega seu user_id (`@userinfobot` → `/start`)
6. No Coolify (Environment Variables, mantém os outros que já estão):
   ```
   IGOR_BOT_TOKEN=<token do BotFather>
   IGOR_BOT_ALLOWED_USER_IDS=1790195641,<user_id_igor_humano>
   ```
7. Me avisa "bot configurado" — eu disparo redeploy

Depois, no Telegram, manda `/start` pro `@Igor_Babolin_bot`. Funciona:
- 14 slash commands (`/status /leads /lead <id> /pendentes /aprovar /rejeitar /imoveis /imovel /briefing /log /agenda /timeline /ajuda /start`)
- Texto livre em português → dispatcher classifica intent → executa
- Áudio (voice) → Whisper transcreve → executa
- Push proativo: lead quente, aprovação >24h, briefing 07:00, relatório semanal

## Visão Igor humano (DNA) — incorporada hoje

Igor humano mandou briefing completo da arquitetura ideal. Salvei como **`cerebro/Visao_Igor_Operacao_Ideal.md`** no repo. Vai pra prod automaticamente e o `contextoDNA()` injeta nos prompts dos agentes.

Arquitetura proposta (6 agentes + extras):
1. Captação Leads (Insta + WhatsApp)
2. Comercial / Pré-venda (CRM + agenda + apresentações + follow-up + docs)
3. Atendimento 24/7 (chatbot + escalonamento auto)
4. Pós-venda (lembretes + NPS + up-sell + boletos)
5. Dashboard / Relatórios (com alertas proativos)
6. Portal Proprietários

Skills sob demanda (palavra-chave ativa, dormem por padrão):
- Skill Creator
- Prompt + Design
- PDF / XLSX / PPTX / DOCX
- Contratos
- Find Skills

## Decisões de produto antigas (sem urgência)

| Mock atual | Decisão pendente |
|---|---|
| Designer `gerar_arte` (imagem real) | API: DALL-E 3 / Bannerbear / Placid / Canva templates |
| Atendimento pós-venda fluxo concreto | Vistoria? Contrato? Checklist? |
| Financeiro extrato real | Inter API / Pluggy / OFX manual |

## O que já existe em produção (sessão 2026-05-16)

### Infra
- VPS dedicada `2.24.103.7` (Hostinger KVM 2, Ubuntu)
- Coolify v4.0.0 com auto-deploy via API
- Domínio `babolin.tech` + `www.babolin.tech` com SSL Let's Encrypt automático
- Volume persistente `igor-data` em `/data` (banco + cache de voz)
- Healthcheck Docker (`/api/saude` a cada 30s, restart auto se travar)

### Aplicação
- Dashboard `https://babolin.tech/dashboard.html` (atrás de login)
- Página de login bonita `/login.html` (dark, Playfair Display, sem popup feio)
- Cookie HttpOnly de sessão 30 dias (HMAC SHA256)
- Botão Logout na sidebar
- Endpoint `/api/auth/me` (dashboard sabe quem está logado)

### Agentes (rodando 24/7)
- Maestro Igor + 6 agentes (SDR, Financeiro, Designer, Social, Pesquisa, Atendimento)
- Heartbeat em todos os crons proativos (3D mostra "rodando" real)
- IA: Groq Llama 3.1 8B (primary) → Gemini → Anthropic (fallback)
- DNA Cérebro Obsidian injetado nos prompts (incluindo Visão Igor)
- SDR com análise estruturada + `proxima_acao` + push proativo de lead quente (≥85)
- Social/Designer com regras anti-clichê + DNA + 6 hashtags localidade
- Briefing matinal 07:00 (push Telegram)
- Relatório semanal seg 07:30 (push Telegram)

### Visual
- Escritório Voxel 3D (R3F) integrado via iframe no dashboard
- 7 agentes voxel animados (idle / typing / walking)
- Modos Live / Typing / Walking / Pausa
- Hover mostra status real-time, click abre painel detalhado

### Endpoints novos hoje
- `GET /api/agentes/status` — formato consumido pelo 3D
- `GET /api/auth/me` — quem está logado
- `POST /api/auth/login`, `POST /api/auth/logout` — sessão cookie
- `GET /api/voz/status`, `GET /api/voz/vozes`, `POST /api/voz/gerar` — ElevenLabs TTS

### Pronto pra ativar (só falta env var)
- **Bot Telegram** — falta `IGOR_BOT_TOKEN` + `IGOR_BOT_ALLOWED_USER_IDS`
- **ElevenLabs voz** — falta `ELEVENLABS_API_KEY` (voice_id já configurado: `SmoiEq4ZbybjsQdqveXv`)

## Próxima sessão grande — Skills sob demanda

O Igor humano pediu skills que **dormem por padrão e acordam por palavra-chave**. Padrão Hermes Agent. Plan:

1. Tabela `skills` no SQLite com FTS5 (id, slug, descricao, prompt_template, matchers JSON, ativa)
2. Seed inicial com as 8 skills pedidas (creator, prompt+design, PDF, XLSX, PPTX, DOCX, contratos, find-skills)
3. `bot/skills.js` — função `matchSkill(texto)` retorna skill se algum matcher bater
4. `bot.on('text')` checa skills ANTES do dispatcher
5. Comandos `/skills` lista, `/skill <slug>` força execução
6. (Futuro) Curador LLM observa logs de execução e propõe skills novas automaticamente

Implementação: ~2-3h de código. Próxima sessão.
