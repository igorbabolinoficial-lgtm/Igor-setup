# AGENTS.md — Igor Babolin Neural System

> Pra QUALQUER agente de IA (Claude, Gemini, Cursor, Copilot, ChatGPT) trabalhando nesse projeto.

## ANTES de qualquer ação

Lê **`C:\Users\55119\.gemini\antigravity\AGENTS.md`** (regras universais Levi) e depois isso aqui.

## Stack desse projeto

- Node 22 + Express + better-sqlite3 (WAL) + node-cron + cheerio + Telegraf
- Frontend: Vanilla JS no `public/dashboard.html` + 2 subprojetos Vite/React
  - `escritorio/` → Voxel 3D dos agentes (build em `public/escritorio/`)
  - `showcase/` → Vitrine 3D pública dos imóveis (build em `public/showcase/`)
- IA: wrapper `agentes/ia.js` com Groq → Gemini → Anthropic (fallback)
- Cérebro: Obsidian dentro do repo em `cerebro/` (montado pelo Dockerfile como `OBSIDIAN_PATH=/app/cerebro`)

## Hospedagem em produção

- **URL**: https://babolin.tech (+ www.babolin.tech)
- **VPS**: Hostinger Ubuntu KVM 2, IP `2.24.103.7`, expira 2027-05-16
- **Plataforma**: Coolify v4.0.0 (auto-deploy via API quando há push no main)
- **App UUID**: `pj0zvd0vnvu521h4pfw6z5yb`
- **Repo GitHub**: `github.com/igorbabolinoficial-lgtm/Igor-setup` (público no momento)
- **Volume persistente**: `igor-data` montado em `/data` (preserva `igor.db` + fotos em `/data/assets/imoveis`)
- **SSL**: Let's Encrypt automático via Traefik (gerenciado pelo Coolify)

## NÃO PROPOR sem motivo concreto

- Criar VPS nova (já tem dedicada)
- Migrar pra Vercel/Netlify (já está em Coolify funcional)
- Trocar SQLite por Postgres (WAL aguenta o volume atual com sobra)
- Trocar Vite por Next.js (sem necessidade)
- Criar repo separado pra uma feature pequena (consolidar como subprojeto Vite tipo `escritorio/` ou `showcase/`)

## Padrão pra adicionar feature 3D nova

Igual `escritorio/` e `showcase/`:

1. Cria pasta nova `<nome>/` no root do projeto
2. `package.json` com `vite build` apontando pra `../public/<nome>/`
3. `vite.config.js` com `base: '/<nome>/'`
4. No `Dockerfile`: adicionar bloco copiando + instalando + buildando
5. No `server.js`: adicionar `if (pathname.startsWith('/<nome>/')) return true;` na whitelist de rotas públicas
6. Acessível em `https://babolin.tech/<nome>/`

**NÃO criar subdomínio novo nem repo separado.** Tudo na mesma URL base + mesmo deploy.

## Agentes do sistema (não confundir com agentes de IA externos)

Maestro + 11 agentes especialistas (SDR, Closer, Account Manager, Financeiro, Estrategista, Copywriter, Designer, Mídia Paga, Community Manager, Social, Pesquisa, Atendimento). Lista em `agentes/<nome>.js`.

## Skills sob demanda

Tabela `skills` com 8 skills seed (Creator, Prompt+Design, PDF, XLSX, PPTX, DOCX, Contratos, Find Skills). Dormem por padrão, acordam por palavra-chave no bot Telegram OU clique no painel `/dashboard.html` → aba Skills.

## Auth

- Login HTML em `/login.html`
- Cookie HMAC SHA256, 30 dias
- Rotas públicas (whitelist): `/`, `/login.html`, `/api/auth/*`, `/api/ai/publica`, `/api/saude`, `/api/webhooks/*`, `/api/voz/status`, `/api/sistema/ia-status`, `/api/sistema/ia-teste`, `/escritorio/*`, `/showcase/*`, `GET /api/imoveis*`, `/media/*`, estáticos
- Resto protegido por cookie
- `IGOR_ADMIN_USER` / `IGOR_ADMIN_PASS` env vars no Coolify

## Auto-deploy

Após push no `main`, agente Claude com `.coolify-token.txt` local dispara `POST /api/v1/deploy?uuid=pj0zvd0vnvu521h4pfw6z5yb&force=true`. Outros agentes podem disparar manualmente no Coolify ou pedir pro Levi (botão Deploy no painel).
