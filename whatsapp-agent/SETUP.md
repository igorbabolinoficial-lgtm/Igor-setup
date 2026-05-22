# WhatsApp Agentic — Igor Babolin

Motor que ouve WhatsApp do Igor (48 9149-3622) e responde automaticamente qualificando leads via Groq Llama 3.3.

Arquitetura idêntica ao do Charles Nobre — diferenças:
- Catálogo lido via `babolin.tech/api/imoveis` (não Supabase).
- Storage local em SQLite (`/data/wa-agent.db`), não Supabase.
- Sem Sheets/Broadcast (features extras do Charles, podem ser adicionadas depois).

## Passos no Coolify

### 1. Card WAHA (gateway WhatsApp)

- Image: `devlikeapro/waha:noweb`
- Domain: `whatsapp-igor.babolin.tech` (HTTPS via Let's Encrypt)
- Volume persistente: `igor-waha-sessions` → mount em `/app/.sessions`
- Env vars:
  ```
  WHATSAPP_API_KEY_PLAIN=<gere com: openssl rand -hex 24>
  WHATSAPP_DEFAULT_ENGINE=NOWEB
  ```
- Health check: `GET /api/health`

### 2. Card wa-agent-igor (este projeto)

- Build context: `whatsapp-agent/` deste repo
- Domain: `wa-agent-igor.babolin.tech`
- Volume persistente: `igor-wa-agent-db` → mount em `/data`
- Env vars: copiar do `.env.example` deste diretório. Críticas:
  ```
  WAHA_API_URL=https://whatsapp-igor.babolin.tech
  WAHA_API_KEY=<o mesmo WHATSAPP_API_KEY_PLAIN do card WAHA>
  WAHA_SESSION_NAME=default
  WEBHOOK_TOKEN=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
  GROQ_API_KEY=<console.groq.com/keys>
  IGOR_NOME=Igor Babolin
  IGOR_CRECI=55601
  IGOR_WHATSAPP=4891493622
  ```

### 3. Pareamento do WhatsApp

Depois dos 2 cards deployados:

```bash
TOKEN=<WEBHOOK_TOKEN>
URL=https://wa-agent-igor.babolin.tech

# Cria sessão WAHA + registra webhook
curl -s -X POST "$URL/setup/create-instance?token=$TOKEN"

# Pega QR code
curl -s "$URL/setup/qr?token=$TOKEN" -o qr.json

# Regera QR localmente (mais legível que o PNG pequeno do WAHA)
python -c "import json, qrcode; d=json.load(open('qr.json')); qr=qrcode.QRCode(box_size=14, border=4); qr.add_data(d['code']); qr.make(); qr.make_image().save('qr.png')"

# Abre qr.png e escaneia no WhatsApp do Igor em < 30s
```

**Importante (aprendizado do Charles):** WAHA noweb prefere **WhatsApp Business**. Se o pareamento falhar com WhatsApp comum, migra a conta pra Business primeiro.

### 4. Testar

```bash
# Status da sessão
curl -s "$URL/status?token=$TOKEN"

# Manda mensagem de teste pro próprio número
curl -s -X POST -H "x-webhook-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"phone":"5548991493622"}' "$URL/send/test"
```

Quando alguém manda mensagem pro Igor no WhatsApp, o WAHA dispara webhook → wa-agent persiste → coalescer agrupa inbounds em 4s → Groq processa com contexto do catálogo de babolin.tech → resposta volta via WAHA com typing realista.

### 5. Monitorar conversas

```bash
curl -s "$URL/admin/conversas?since=60&limit=50&token=$TOKEN" | jq
```

## Variáveis que você ainda precisa decidir

- `GROQ_API_KEY` (use a mesma chave do LMP/Charles se já tem ativa)
- `IGOR_LEAD_SYNC_URL` — pra leads novos do WhatsApp aparecerem no Kanban do `babolin.tech/dashboard.html → Leads`, setar como `https://babolin.tech/api/contato` (rota pública, mesma usada pelo formulário do site). `IGOR_API_TOKEN` é opcional (ainda não há validação no receptor, mantido pra uso futuro). A chamada dispara só na 1ª mensagem do lead novo (em `persistIncoming → findOrCreateLeadByPhone({ created: true })`).

## Comandos úteis (igual Charles)

```bash
# Reset sessão se travar
curl -s -X POST "$URL/setup/reset-instance?token=$TOKEN"
sleep 5
curl -s "$URL/setup/qr?token=$TOKEN" -o qr.json
# regerar qr.png como acima
```
