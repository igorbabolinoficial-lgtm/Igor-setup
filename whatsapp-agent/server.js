// WhatsApp Agentic Server — Igor Babolin
// Roda no Coolify, conecta com WAHA noweb + Groq + SQLite local.
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { persistIncoming, processBatch, enviarManual } from './lib/conversation.js';
import { parseIncomingMessage, createInstance, deleteInstance, getQrCode, getInstanceState, sendText } from './lib/waha.js';
import { normalizePhone, db } from './lib/storage.js';
import { coalesceIncoming } from './lib/coalescer.js';
import { log } from './lib/logger.js';

dotenv.config();

const PORT = parseInt(process.env.PORT, 10) || 3030;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN;

const app = express();
app.use(express.json({ limit: '5mb' }));

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function requireToken(req, res, next) {
  const provided = req.headers['x-webhook-token'] || req.query.token;
  if (!WEBHOOK_TOKEN) return res.status(503).json({ error: 'WEBHOOK_TOKEN nao configurado' });
  if (!provided || !timingSafeEqual(provided, WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'Token invalido' });
  }
  next();
}

// --- HEALTH ---
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/status', requireToken, async (_req, res) => {
  try { res.json(await getInstanceState()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PAREAMENTO ---
app.post('/setup/create-instance', requireToken, async (req, res) => {
  try {
    const webhookUrl = `${req.protocol}://${req.get('host')}/webhook/waha?token=${WEBHOOK_TOKEN}`;
    const result = await createInstance(webhookUrl);
    res.json({ ok: true, result, webhook: webhookUrl });
  } catch (err) {
    log.error('Falha criando instancia', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/setup/reset-instance', requireToken, async (req, res) => {
  try {
    await deleteInstance();
    const webhookUrl = `${req.protocol}://${req.get('host')}/webhook/waha?token=${WEBHOOK_TOKEN}`;
    const result = await createInstance(webhookUrl);
    res.json({ ok: true, reset: true, result, webhook: webhookUrl });
  } catch (err) {
    log.error('Falha resetando instancia', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/setup/qr', requireToken, async (_req, res) => {
  try { res.json(await getQrCode()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- WEBHOOK WAHA ---
// Aceita /webhook/waha (novo) e /webhook/evolution (legacy do Charles, mesmo handler)
async function handleWebhook(req, res) {
  const provided = req.query.token;
  if (!WEBHOOK_TOKEN || !provided || !timingSafeEqual(provided, WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'Token invalido' });
  }
  res.json({ ok: true });

  const payload = req.body;
  const event = payload?.event;
  log.debug('Webhook recebido', { event });

  if (event !== 'message' && event !== 'message.any' && event !== 'messages.upsert') return;

  const parsed = parseIncomingMessage(payload);
  if (!parsed) return;

  persistIncoming(parsed)
    .then((enriched) => coalesceIncoming(enriched.phone, enriched, processBatch))
    .catch((err) => {
      log.error('Falha processando inbound', { phone: parsed.phone, err: err.message, stack: err.stack });
    });
}
app.post('/webhook/waha', handleWebhook);
app.post('/webhook/evolution', handleWebhook); // legacy compat

// --- CONVERSAS (lista mensagens recentes pra monitorar) ---
app.get('/admin/conversas', requireToken, (req, res) => {
  try {
    const sinceMin = parseInt(req.query.since, 10) || 30;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const direction = req.query.direction;
    const cutoff = new Date(Date.now() - sinceMin * 60_000).toISOString();

    let sql = `
      SELECT m.id, m.phone, m.direction, m.body, m.created_at, m.agent_response, m.lead_id, l.name
      FROM whatsapp_messages m LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.created_at >= ?
    `;
    const params = [cutoff];
    if (direction === 'in' || direction === 'out') { sql += ' AND m.direction = ?'; params.push(direction); }
    sql += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const msgs = db.prepare(sql).all(...params);
    res.json({ ok: true, sinceMin, count: msgs.length, msgs });
  } catch (err) {
    log.error('Falha listando conversas', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- ENVIO MANUAL ---
app.post('/send', requireToken, async (req, res) => {
  const { phone, text, leadId } = req.body || {};
  if (!phone || !text) return res.status(400).json({ error: 'phone e text obrigatorios' });
  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: 'phone invalido' });
  try {
    const result = await enviarManual(normalized, text, leadId);
    res.json(result);
  } catch (err) {
    log.error('Falha no envio manual', { phone, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/send/test', requireToken, async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone obrigatorio' });
  const normalized = normalizePhone(phone);
  try {
    const result = await sendText(normalized, '[teste] WhatsApp Agentic Igor online.');
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ERROR HANDLER ---
app.use((err, _req, res, _next) => {
  log.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(PORT, () => {
  log.info('WhatsApp Agentic Igor online', {
    port: PORT,
    instance: process.env.WAHA_SESSION_NAME || 'default',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  });
});
