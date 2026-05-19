// Conexão direta com WhatsApp via @whiskeysockets/baileys (substitui WAHA).
// Mantém a mesma API pública que waha.js tinha — conversation.js não muda imports.
import baileys, {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_DIR = process.env.BAILEYS_AUTH_DIR ||
  path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..')), 'baileys-auth');

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let _sock = null;
let _qrRaw = null;
let _state = 'STOPPED'; // STOPPED | STARTING | WORKING | SCAN_QR
let _onIncoming = null;
let _reconnectTimer = null;
let _connectInProgress = false;

export function registerIncomingHandler(handler) {
  _onIncoming = handler;
}

export async function connect() {
  // Idempotente — nao reconecta se ja esta WORKING ou conectando.
  if (_connectInProgress) return;
  if (_state === 'WORKING' && _sock) return;
  _connectInProgress = true;
  _state = 'STARTING';
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log.info('Baileys conectando', { authDir: AUTH_DIR, version, isLatest });

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      browser: ['Igor Babolin', 'Chrome', '120.0.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    _sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        _qrRaw = qr;
        _state = 'SCAN_QR';
        log.info('Baileys gerou QR', { len: qr.length });
      }
      if (connection === 'open') {
        _state = 'WORKING';
        _qrRaw = null;
        log.info('Baileys conectado ao WhatsApp');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = DisconnectReason[Object.keys(DisconnectReason).find((k) => DisconnectReason[k] === code)] || code;
        _state = 'STOPPED';
        log.warn('Baileys conexao fechada', { code, reason });
        if (code !== DisconnectReason.loggedOut) {
          if (_reconnectTimer) clearTimeout(_reconnectTimer);
          _reconnectTimer = setTimeout(() => connect(), 3000);
        } else {
          log.warn('Logged out — auth invalido, precisa novo QR');
          // limpa auth pra forcar QR novo na proxima
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch {}
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const parsed = parseMessage(msg);
        if (parsed && _onIncoming) {
          try { await _onIncoming(parsed); }
          catch (err) { log.error('Falha handler inbound', { phone: parsed.phone, err: err.message, stack: err.stack }); }
        }
      }
    });
  } finally {
    _connectInProgress = false;
  }
}

export async function disconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_sock) {
    try { await _sock.logout(); } catch {}
    _sock = null;
  }
  _state = 'STOPPED';
}

// Apaga auth + reconecta (gera QR novo).
export async function resetSession() {
  await disconnect();
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await connect();
  return { ok: true, reset: true };
}

export function getQrCodeRaw() {
  return _qrRaw;
}

export function getState() {
  return _state;
}

// --- Parse de mensagem inbound (formato Baileys -> formato interno) ---
function parseMessage(msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return null;
  if (remoteJid.endsWith('@g.us')) return null; // ignora grupos
  if (remoteJid === 'status@broadcast') return null;
  const phone = remoteJid.replace(/@.*$/, '');
  const m = msg.message;
  if (!m) return null;

  let body = '';
  let mediaType = null;
  let mediaMimetype = null;
  let hasMedia = false;

  if (m.conversation) {
    body = m.conversation;
  } else if (m.extendedTextMessage?.text) {
    body = m.extendedTextMessage.text;
  } else if (m.audioMessage) {
    mediaMimetype = m.audioMessage.mimetype || 'audio/ogg; codecs=opus';
    mediaType = mediaMimetype;
    hasMedia = true;
  } else if (m.imageMessage) {
    mediaMimetype = m.imageMessage.mimetype || 'image/jpeg';
    mediaType = 'image/jpeg';
    body = m.imageMessage.caption || '[imagem]';
    hasMedia = true;
  } else if (m.videoMessage) {
    mediaMimetype = m.videoMessage.mimetype || 'video/mp4';
    mediaType = 'video/mp4';
    body = m.videoMessage.caption || '[video]';
    hasMedia = true;
  } else if (m.documentMessage) {
    body = `[documento: ${m.documentMessage.fileName || 'arquivo'}]`;
    hasMedia = true;
  } else if (m.stickerMessage) {
    body = '[sticker]';
  } else if (m.locationMessage) {
    body = '[localizacao]';
  } else if (m.contactMessage) {
    body = '[contato]';
  } else {
    return null;
  }

  // Guarda remoteJid raw pra responder no mesmo JID (mais robusto que reconstruir
  // de phone, especialmente quando lead esta em @lid de Multi-Device).
  return {
    phone,
    remoteJid,                        // <- jid original ex: "5511...@s.whatsapp.net" ou "54073...@lid"
    pushName: msg.pushName || null,
    body,
    wahaMessageId: msg.key.id,
    mediaType,
    mediaMimetype,
    mediaUrl: null,
    rawMsg: hasMedia ? msg : null,
    fromIsLid: remoteJid.endsWith('@lid'),
  };
}

// Compat: assinatura igual a do waha.js (incoming -> { buffer, mimetype })
export async function downloadMediaFromUrl(_url, mimetype, opts = {}) {
  // No baileys nao temos URL — tem que vir o rawMsg via opts.rawMsg
  const rawMsg = opts.rawMsg;
  if (!rawMsg) return null;
  try {
    const buffer = await downloadMediaMessage(rawMsg, 'buffer', {});
    return { buffer, mimetype };
  } catch (err) {
    log.warn('Falha baixando media baileys', { err: err.message });
    return null;
  }
}

// Resolve LID: nao se aplica no baileys (entrega phone real)
export async function resolveLidToPhone(_lid) { return null; }

// --- Envio ---
function phoneToJid(phoneOrJid) {
  if (!phoneOrJid) return null;
  const s = String(phoneOrJid);
  if (s.includes('@')) return s;            // ja eh JID completo
  const p = s.replace(/\D/g, '');
  if (p.length >= 14) return `${p}@lid`;    // 14+ digitos = LID Multi-Device
  return `${p}@s.whatsapp.net`;
}

// Resolve o JID de destino: preferencia pra remoteJid raw quando disponivel.
function resolveTargetJid(phoneOrJid, explicitJid) {
  return explicitJid || phoneToJid(phoneOrJid);
}

export async function sendText(phone, body, remoteJid) {
  if (!_sock) throw new Error('Baileys nao conectado');
  const jid = resolveTargetJid(phone, remoteJid);
  const sent = await _sock.sendMessage(jid, { text: body });
  return {
    key: { id: sent?.key?.id, remoteJid: jid, fromMe: true },
    status: 'SENT',
  };
}

export async function sendVoice(phone, audioBuffer, mimeType = 'audio/ogg; codecs=opus', remoteJid) {
  if (!_sock) throw new Error('Baileys nao conectado');
  const jid = resolveTargetJid(phone, remoteJid);
  const sent = await _sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: mimeType,
    ptt: true,
  });
  log.info('Audio enviado (baileys)', { phone, jid, bytes: audioBuffer.length, id: sent?.key?.id });
  return {
    key: { id: sent?.key?.id, remoteJid: jid, fromMe: true },
    status: 'SENT',
  };
}

export async function sendImage(phone, imageUrl, caption) {
  if (!_sock) throw new Error('Baileys nao conectado');
  const jid = phoneToJid(phone);
  // Baileys aceita URL OU buffer
  const sent = await _sock.sendMessage(jid, { image: { url: imageUrl }, caption: caption || '' });
  return sent;
}

export async function setTyping(phone, on = true, remoteJid) {
  if (!_sock) return;
  try {
    const jid = resolveTargetJid(phone, remoteJid);
    await _sock.sendPresenceUpdate(on ? 'composing' : 'paused', jid);
  } catch (err) {
    log.debug('Falha setTyping', { err: err.message });
  }
}

// Compat com waha.js: parseIncomingMessage devolve null pq agora entra pelo handler
// registrado em registerIncomingHandler. Mantido pra evitar import error.
export function parseIncomingMessage(_payload) { return null; }

export async function getInstanceState() {
  return { instance: { instanceName: 'baileys', state: _state === 'WORKING' ? 'open' : 'close', rawStatus: _state } };
}

// Stubs pra compat com server.js que tinha endpoints WAHA-style
export async function createInstance(_webhookUrl) {
  if (_state === 'STOPPED' || _state === 'SCAN_QR' || !_sock) {
    await connect();
  }
  return { name: 'baileys', status: _state };
}
export async function deleteInstance() {
  return await resetSession();
}
export async function getQrCode() {
  if (!_qrRaw) return { code: null, base64: null, count: 0 };
  // Gera PNG base64 do QR
  const QRCode = (await import('qrcode')).default;
  const dataUrl = await QRCode.toDataURL(_qrRaw, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
  return { code: _qrRaw, base64: dataUrl, count: 1 };
}
