// WhatsApp Agentic Server — Igor Babolin
// Conecta DIRETO no WhatsApp via Baileys (sem WAHA intermediário).
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { existsSync, createReadStream } from 'fs';
import { join, basename } from 'path';
import { persistIncoming, processBatch, enviarManual } from './lib/conversation.js';
import { iniciarFollowupCron } from './lib/followup-runner.js';
import {
  connect as connectBaileys,
  registerIncomingHandler,
  registerOutgoingHandler,
  getState,
  getQrCode,
  resetSession,
  sendText,
} from './lib/baileys.js';
import { normalizePhone, db, setHumanTakeover, clearHumanTakeover, isHumanTakeover } from './lib/storage.js';
import { pausarCadencia } from './lib/cadencia.js';
import { coalesceIncoming } from './lib/coalescer.js';
import { log } from './lib/logger.js';

dotenv.config();

const MEDIA_DIR = process.env.MEDIA_DIR || (process.env.DB_PATH ? join(process.env.DB_PATH.replace(/\/[^/]+$/, ''), 'media') : '/data/media');
const MIME_EXT = { '.ogg':  'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
                   '.aac':  'audio/aac',  '.wav': 'audio/wav',
                   '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
                   '.png':  'image/png',  '.webp': 'image/webp', '.gif': 'image/gif',
                   '.mp4':  'video/mp4',  '.3gp':  'video/3gpp', '.bin': 'application/octet-stream' };

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

app.get('/status', requireToken, (_req, res) => {
  const state = getState();
  res.json({ instance: { instanceName: 'baileys', state: state === 'WORKING' ? 'open' : 'close', rawStatus: state } });
});

// --- PAREAMENTO ---
app.post('/setup/create-instance', requireToken, async (_req, res) => {
  try {
    await connectBaileys();
    res.json({ ok: true, status: getState() });
  } catch (err) {
    log.error('Falha conectando baileys', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/setup/reset-instance', requireToken, async (_req, res) => {
  try {
    const r = await resetSession();
    res.json(r);
  } catch (err) {
    log.error('Falha resetando baileys', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/setup/qr', requireToken, async (_req, res) => {
  try {
    const qr = await getQrCode();
    res.json(qr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CONVERSAS ---
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

// --- DASHBOARD: lista leads com última mensagem ---
app.get('/admin/leads', requireToken, (req, res) => {
  try {
    const leads = db.prepare(`
      SELECT l.phone, l.name, l.status, l.whatsapp_status, l.last_whatsapp_at, l.meta,
             m.body   AS last_body,
             m.direction AS last_direction,
             m.created_at AS last_at
      FROM leads l
      LEFT JOIN whatsapp_messages m ON m.id = (
        SELECT id FROM whatsapp_messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY l.last_whatsapp_at DESC NULLS LAST
      LIMIT 200
    `).all();
    res.json({ ok: true, leads });
  } catch (err) {
    log.error('Falha listando leads dashboard', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- DASHBOARD: histórico de conversa por phone ---
app.get('/admin/conversas/:phone', requireToken, (req, res) => {
  try {
    const phone = req.params.phone;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const msgs = db.prepare(`
      SELECT * FROM (
        SELECT m.id, m.phone, m.direction, m.body, m.created_at, m.agent_response, m.lead_id, m.meta, m.media_url, l.name
        FROM whatsapp_messages m
        LEFT JOIN leads l ON l.id = m.lead_id
        WHERE m.phone = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC
    `).all(phone, limit);
    res.json({ ok: true, msgs });
  } catch (err) {
    log.error('Falha buscando conversa', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- BACKFILL: retorna todos os leads com suas preferências salvas (meta.preferencias)
//    Usado pelo igor-neural-system pra sincronizar status do pipeline retroativamente. ---
app.get('/admin/leads-prefs', requireToken, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT phone, name, meta
      FROM leads
      WHERE last_whatsapp_at IS NOT NULL
      ORDER BY last_whatsapp_at DESC
    `).all();

    const leads = rows.map(l => {
      let prefs = {};
      try { prefs = JSON.parse(l.meta || '{}').preferencias || {}; } catch {}
      return { phone: l.phone, name: l.name || null, prefs };
    });

    res.json({ ok: true, leads });
  } catch (err) {
    log.error('Falha listando leads-prefs', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- MÍDIA: serve arquivos salvos em disco ---
app.get('/media/:filename', requireToken, (req, res) => {
  const filename = basename(req.params.filename); // bloqueia path traversal
  const filepath = join(MEDIA_DIR, filename);
  if (!existsSync(filepath)) return res.status(404).json({ error: 'midia nao encontrada' });
  const ext = '.' + filename.split('.').pop().toLowerCase();
  const contentType = MIME_EXT[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  createReadStream(filepath).pipe(res);
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

// --- HUMAN TAKEOVER ---
// Para o bot manualmente nessa conversa (ativa takeover por 24h)
app.post('/takeover/set/:phone', requireToken, async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.status(400).json({ error: 'phone invalido' });
  await setHumanTakeover(normalized);
  res.json({ ok: true, phone: normalized, message: 'Bot pausado nessa conversa por 24h' });
});

// Libera manualmente uma conversa do takeover (bot volta a responder antes das 24h)
app.post('/takeover/release/:phone', requireToken, async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.status(400).json({ error: 'phone invalido' });
  await clearHumanTakeover(normalized);
  res.json({ ok: true, phone: normalized, message: 'Bot reativado nessa conversa' });
});

// Consulta se uma conversa esta em takeover
app.get('/takeover/status/:phone', requireToken, async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.status(400).json({ error: 'phone invalido' });
  const ativo = await isHumanTakeover(normalized);
  res.json({ phone: normalized, human_takeover: ativo });
});

// --- CADÊNCIA: pausa follow-ups de um lead (ex: quando convertido no pipeline) ---
app.post('/admin/leads/:phone/pausar-cadencia', requireToken, async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.status(400).json({ error: 'phone invalido' });
  pausarCadencia(normalized);
  log.info('Cadencia pausada manualmente', { phone: normalized });
  res.json({ ok: true, phone: normalized, message: 'Cadência de follow-up pausada' });
});

// --- ERROR HANDLER ---
app.use((err, _req, res, _next) => {
  log.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Erro interno' });
});

// Registra handler de inbound do Baileys ANTES de conectar
registerIncomingHandler((parsed) => {
  // parsed: { phone, body, pushName, mediaType, mediaMimetype, rawMsg, wahaMessageId, fromIsLid }
  persistIncoming(parsed)
    .then((enriched) => coalesceIncoming(enriched.phone, enriched, processBatch))
    .catch((err) => {
      log.error('Falha processando inbound', { phone: parsed.phone, err: err.message, stack: err.stack });
    });
});

// Detecta mensagens enviadas pelo proprio numero (Igor enviando direto do celular)
// -> ativa human takeover por 24h nessa conversa
registerOutgoingHandler((parsed) => {
  const { phone } = parsed;
  if (!phone) return;
  setHumanTakeover(phone).catch((err) => {
    log.error('Falha ao setar human takeover (outgoing)', { phone, err: err.message });
  });
  log.info('Human takeover ativado (outgoing detectado)', { phone });
});

app.listen(PORT, async () => {
  log.info('WhatsApp Agentic Igor online', {
    port: PORT,
    engine: 'baileys',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  });
  // Conecta no WhatsApp automaticamente no boot. Se ainda nao tem auth,
  // QR fica disponivel em /setup/qr e a sessao espera scan.
  connectBaileys().catch((err) => {
    log.error('Falha boot baileys', { err: err.message, stack: err.stack });
  });

  // Inicia cron de follow-up (verifica a cada hora, dispara nas janelas 9h e 17h)
  iniciarFollowupCron();
});
