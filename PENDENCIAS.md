# Pendências — só você consegue fazer

> Tudo abaixo precisa de chave, clique externo ou criação de bot. O resto (código, build, prompts, dispatcher LLM, áudio, heartbeat, notif) já está pronto.

## Ordem sugerida

### 1. Smoke local

```powershell
cd C:\Users\55119\.gemini\antigravity\igor-neural-system
node server.js
```

Abrir `http://localhost:3003/dashboard.html` → aba **Rede de Agentes** → você deve ver o Escritório Voxel 3D com Maestro + 6 agentes voxel ao redor das mesas (modos Live / Typing / Walking / Pausa no painel direito).

### 2. Plugar Groq — destrava IA real em TODA a rede

Sem Groq, todos os agentes operam em fallback. Com Groq plugado, **TUDO** vira inteligência real: SDR qualifica leads com análise estruturada, Social/Designer geram copy com DNA do Cérebro, Briefing matinal escreve hipóteses, Bot Telegram entende texto livre e áudio, chatbot público responde com contexto.

1. Pegar chave free em https://console.groq.com/keys
2. Adicionar no `.env`:
   ```
   GROQ_API_KEY=gsk_...
   ```
3. (opcional) Override de modelo:
   ```
   GROQ_MODEL_TEXT=llama-3.1-8b-instant     # default — rápido e free tier generoso
   # GROQ_MODEL_TEXT=llama-3.3-70b-versatile   # alternativa: mais agressivo, free tier menor
   GROQ_MODEL_AUDIO=whisper-large-v3-turbo  # default
   ```
4. `node server.js` reinicia. Próximo ciclo do SDR/Social/Designer + briefing 07:00 já usam Groq.

Ordem de fallback: **Groq → Gemini → Anthropic**. Se Groq cair, Gemini assume (se chave configurada). Se ambos caírem, fallback heurístico sem IA.

### 3. Criar bot Telegram

1. `@BotFather` no Telegram → `/newbot` → nome: **Igor Babolin Neural** → username sugerido `@Igor_Babolin_bot`
2. Copiar o token
3. Pegar seu user_id (`@userinfobot` no Telegram)
4. No `.env`:
   ```
   IGOR_BOT_TOKEN=<token do BotFather>
   IGOR_BOT_ALLOWED_USER_IDS=1790195641,<id_do_igor_humano_se_for_o_caso>
   ```
5. Reiniciar. Log esperado: `[bot] @Igor_Babolin_bot rodando (allowlist: N usuários)`

**O que o bot faz hoje:**
- 14 slash commands: `/status /leads /lead /pendentes /aprovar /rejeitar /imoveis /imovel /briefing /log /agenda /timeline /ajuda /start`
- **Texto livre**: você manda "tem casa em ibiraquera?" → ele classifica e responde como `/imoveis ibiraquera`. "como tá o sistema?" vira `/status`. Múltiplas intents numa mensagem só funcionam.
- **Áudio (voice)**: manda áudio do WhatsApp → Whisper transcreve → ecoa o que ouviu → roteia pelo dispatcher.
- **Notificação proativa pra allowlist**:
  - Lead novo via chatbot público (push imediato)
  - Lead quente (score IA ≥85)
  - Aprovação pendente >24h (lembrete 1x por dia)
  - Aprovação expirada >7d
  - Briefing matinal 07:00 (resumo no celular)
  - Relatório semanal segunda 07:30

### 4. Deploy na VPS DEDICADA `2.24.103.7` (24/7)

A VPS nova da Hostinger (`srv1676224.hstgr.cloud`, IP `2.24.103.7`, Ubuntu KVM 2) é dedicada ao Igor. Está vazia — precisa instalar o Coolify primeiro.

**4.1 — Repo no GitHub** (precisa de você)

Local já está pronto: `git init` feito, commit inicial criado. Falta criar o repo no GitHub e push.

1. https://github.com/new → nome `igor-neural-system` → Private → criar SEM README/gitignore (já tem)
2. No terminal local:
   ```powershell
   cd C:\Users\55119\.gemini\antigravity\igor-neural-system
   git remote add origin git@github.com:levimpantarotto-commits/igor-neural-system.git
   git push -u origin main
   ```

**4.2 — Instalar Coolify na VPS nova**

1. Painel Hostinger → VPS → Gerenciar → Browser Terminal (ou SSH com sua key)
2. Rodar (1 linha, instala tudo):
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```
3. Aguardar ~5 min. No fim mostra URL e credenciais iniciais.
4. Abrir `http://2.24.103.7:8000` no browser → criar conta admin
5. Configurar GitHub App (Settings → Sources → GitHub) — ou pode usar Deploy Key/Personal Access Token se quiser pular o GitHub App

**4.3 — Deployar Igor no Coolify**

1. + New Resource → Private Repository
2. Repo `levimpantarotto-commits/igor-neural-system`, branch `main`
3. Build Pack: **Dockerfile**, Base Directory `/`, Port `3003`
4. Env vars (cola todas):
   - `NODE_ENV=production`
   - `PORT=3003`
   - `GROQ_API_KEY=...`
   - `IGOR_BOT_TOKEN=...`
   - `IGOR_BOT_ALLOWED_USER_IDS=...`
   - (opcional) `GEMINI_API_KEY=...` se quiser fallback
5. **Persistent storage**: nome `igor-data`, mount path `/app` — preserva `igor.db` e `public/escritorio/` entre redeploys
6. **Antes do deploy**: parar `node server.js` local (Telegram só aceita 1 polling por token).
7. Deploy. Acessar `http://2.24.103.7:3003/dashboard.html`

**4.4 — (opcional) Domínio + HTTPS**

Você tem `praiadorosa.site` (visto no painel Hostinger). Se quiser:
- Apontar subdomínio `igor.praiadorosa.site` (DNS A → `2.24.103.7`)
- No Coolify: Domains → adicionar `igor.praiadorosa.site` → Let's Encrypt (Coolify gera SSL automático)

### 5. Decisões antigas seguem em aberto

| Mock | Decisão que falta |
|---|---|
| Designer `gerar_arte` (imagem) | API de imagem: DALL-E 3, Bannerbear, Placid, Canva templates |
| Atendimento pós-venda | Fluxo: vistoria, contrato, checklist |
| Financeiro (extrato real) | Inter API, Nubank Pluggy, OFX manual |
| WhatsApp Agentic (Evolution) | Esperar Charles destravar Bad Gateway |

---

## O que foi entregue (1ª e 2ª rodadas desta sessão)

### Rodada 1 — base
- `escritorio/` subprojeto Vite/R3F + 10 componentes do LMP, build em `public/escritorio/`
- iframe `#escritorio3d` no dashboard, SVG antigo escondido
- endpoint `/api/agentes/status` no formato do 3D
- `agentes/ia.js` → Groq → Gemini → Anthropic + `transcreverAudio()` Whisper
- `bot/` módulo Telegram com 11 slash commands, allowlist, rate limit, notif `notificar()`
- hook notif em lead novo do chatbot público
- `Dockerfile` + `.dockerignore`

### Rodada 2 — inteligência
- **Heartbeat plugado em todos os crons proativos** (sem isso o 3D ficava cinza — agora os agentes acendem em verde)
- **DNA do Cérebro Obsidian injetado** nos prompts via `contextoDNA()` em `routes/cerebro.js` (cache 5min)
- **Prompt SDR reforçado**: análise estruturada (orçamento, urgência, fit, bagunça) + JSON com `proxima_acao` e `justificativa` + push proativo quando lead score ≥85
- **Prompt Social reforçado**: hook concreto obrigatório, lista de palavras banidas ("imperdível", "cantinho do paraíso"), tom Praia do Rosa
- **Prompt Designer reforçado**: diferencial específico do imóvel, ZERO emoji na DM, max 3 emojis no post
- **`briefing.js` migrado pra Groq** (era Gemini direto) + push proativo no Telegram quando termina
- **2 comandos novos no bot**: `/agenda`, `/timeline <lead_id>`
- **Dispatcher LLM** (`bot/dispatcher.js`): texto livre → classifica intent via Groq → roteia pelos handlers (14 intents)
- **Áudio no bot**: `bot.on('voice'/'audio')` baixa, transcreve via Whisper, ecoa, roteia
- **4 hooks novos de notif Telegram**: lead quente (score ≥85), aprovação envelhecida >24h, aprovação expirada >7d, briefing pronto, relatório semanal pronto

### Boot validado
```
Igor Neural System rodando em http://localhost:3003
Dashboard: http://localhost:3003/dashboard.html
[bot] IGOR_BOT_TOKEN não setado — bot desligado
```
