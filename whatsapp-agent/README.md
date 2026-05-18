# Charles Nobre WhatsApp Agentic

Motor WhatsApp + IA pra atendimento automático de leads do Charles Nobre Consultoria Imobiliária.

**Stack:** Node 22 ESM + Express + Evolution API (WhatsApp) + Groq (Llama 3.3) + Supabase (DB) + Google Sheets (leads).

**Deploy:** Coolify (mesma VPS do LMP).

📖 **Setup completo:** [SETUP.md](./SETUP.md)

## Quick reference

```bash
# Desenvolvimento local (depois de criar .env)
npm install
npm run dev

# Smoke test do cérebro (precisa GROQ_API_KEY + acesso Supabase)
npm run test-groq

# Importar leads da planilha
npm run sync-sheets

# Broadcast (sempre DRY_RUN primeiro!)
DRY_RUN=1 npm run broadcast
BROADCAST_LIMIT=10 npm run broadcast
```

## O que o agente faz hoje

1. **Recebe** mensagens via webhook da Evolution
2. **Identifica** o lead no Supabase (cria se não existe)
3. **Busca** histórico recente da conversa (últimas 12 msgs)
4. **Carrega** catálogo de imóveis (Supabase `properties`)
5. **Chama** Groq com system prompt do Charles + histórico + catálogo
6. **Envia** resposta de volta via Evolution
7. **Persiste** tudo em `whatsapp_messages`

## O que NÃO faz ainda

- Transcrição de áudios recebidos (precisa Whisper)
- Análise de imagens enviadas pelo lead
- Agendamento automático de visitas (precisa integração com Agenda no /admin)
- Notificação proativa do Charles quando lead pedir humano
- Painel ao vivo no /admin do site
