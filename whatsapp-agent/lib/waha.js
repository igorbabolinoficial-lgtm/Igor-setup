// Cliente HTTP para WAHA (https://waha.devlike.pro/docs)
// Substitui Evolution API. WAHA Core (gratis) suporta 1 sessao chamada "default".
import axios from 'axios';
import { log } from './logger.js';

const BASE = process.env.WAHA_API_URL;
const KEY = process.env.WAHA_API_KEY;
const SESSION = process.env.WAHA_SESSION || 'default';

if (!BASE || !KEY) {
  log.warn('WAHA URL ou KEY ausente - chamadas vao falhar');
}

const http = axios.create({
  baseURL: BASE,
  headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' },
  timeout: 30000,
});

function phoneToChatId(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  // LID do WhatsApp Multi-Device tem 14+ digitos. Usar @lid pra rotear via
  // chat thread (em vez de @c.us que assume phone real e dropa LID).
  if (p.length >= 14) return `${p}@lid`;
  return `${p}@c.us`;
}

function chatIdToPhone(chatId) {
  return String(chatId || '').replace(/@.*$/, '');
}

function isLid(chatId) {
  return String(chatId || '').endsWith('@lid');
}

// Resolve LID -> phone real. WAHA noweb tem variantes de endpoint conforme versao
// e nem sempre tem o LID mapeado se a sessao foi recem-pareada (store nao sincronizou).
// Tenta endpoints diretos primeiro, fallback pra busca em /contacts/all.
let _contactsCache = { ts: 0, data: null };

async function getAllContactsCached() {
  if (_contactsCache.data && Date.now() - _contactsCache.ts < 60_000) return _contactsCache.data;
  try {
    const { data } = await http.get(`/api/${SESSION}/contacts/all`);
    const list = Array.isArray(data) ? data : (data?.contacts || []);
    _contactsCache = { ts: Date.now(), data: list };
    return list;
  } catch (err) {
    log.debug('Falha listando contacts/all', { err: err.message, status: err.response?.status });
    return [];
  }
}

export async function resolveLidToPhone(lid) {
  if (!lid) return null;
  const lidNum = String(lid).replace(/@.*$/, '');
  if (!lidNum) return null;

  // 1. Endpoints diretos — variantes conhecidas
  const tentativas = [
    `/api/${SESSION}/lids/${lidNum}`,
    `/api/${SESSION}/lids/${encodeURIComponent(`${lidNum}@lid`)}`,
    `/api/contacts/lid-pn?lid=${encodeURIComponent(`${lidNum}@lid`)}&session=${SESSION}`,
  ];
  for (const path of tentativas) {
    try {
      const { data } = await http.get(path);
      const pn = data?.pn || data?.phoneNumber || data?.phone || data?.id;
      if (pn) {
        const phone = chatIdToPhone(pn);
        if (phone && phone !== lidNum) {
          log.info('LID resolvido', { via: path, lid: lidNum, phone });
          return phone;
        }
      }
    } catch (err) {
      // segue pra proxima tentativa
    }
  }

  // 2. Fallback: lista todos contatos e procura pelo LID
  const contatos = await getAllContactsCached();
  for (const c of contatos) {
    const cLid = (c.lid || '').replace(/@.*$/, '');
    if (cLid && cLid === lidNum) {
      const phone = chatIdToPhone(c.id || c.number || c.pn || '');
      if (phone && phone !== lidNum) {
        log.info('LID resolvido via contacts/all', { lid: lidNum, phone });
        return phone;
      }
    }
  }

  log.warn('LID nao resolvido em nenhuma fonte', { lid: lidNum, tentativas: tentativas.length });
  return null;
}

// --- Instancia / pareamento ---

export async function createInstance(webhookUrl) {
  const payload = {
    name: SESSION,
    config: {
      // noweb.store ESSENCIAL pra resolver LID -> phone real.
      // Sem isso TODOS endpoints /contacts/* + /lids/* retornam 400/404.
      // full_sync popula o store com historico de contatos no pareamento.
      noweb: {
        store: { enabled: true, fullSync: true },
      },
      webhooks: [
        {
          url: webhookUrl,
          events: ['message', 'session.status'],
          hmac: null,
          retries: { delaySeconds: 2, attempts: 3 },
        },
      ],
    },
  };

  try {
    const { data } = await http.post('/api/sessions/start', payload);
    log.info('Sessao WAHA iniciada', { session: SESSION });
    return data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    if (err.response?.status === 422 || /already|exist/i.test(msg)) {
      log.info('Sessao WAHA ja existe, atualizando webhook', { session: SESSION });
      try {
        await http.put(`/api/sessions/${SESSION}`, payload);
      } catch (e2) {
        log.warn('Falha atualizando sessao existente', { err: e2.message });
      }
      return { exists: true };
    }
    throw err;
  }
}

export async function deleteInstance() {
  try {
    try {
      await http.post(`/api/sessions/${SESSION}/stop`);
    } catch (e) {
      log.debug('Erro ao parar sessao para delecao (normal)', { err: e.message });
    }
    const { data } = await http.delete(`/api/sessions/${SESSION}`);
    log.info('Sessao WAHA deletada com sucesso', { session: SESSION });
    return data;
  } catch (err) {
    log.error('Falha ao deletar sessao WAHA', { session: SESSION, err: err.message });
    throw err;
  }
}

export async function getQrCode() {
  const { data } = await http.get(`/api/${SESSION}/auth/qr`, {
    params: { format: 'raw' },
  });
  const code = data?.value || data?.qr || (typeof data === 'string' ? data : null);
  let base64 = null;
  try {
    const png = await http.get(`/api/${SESSION}/auth/qr`, {
      params: { format: 'image' },
      responseType: 'arraybuffer',
    });
    base64 = `data:image/png;base64,${Buffer.from(png.data).toString('base64')}`;
  } catch (e) {
    log.debug('PNG do QR indisponivel', { err: e.message });
  }
  return { code, base64, count: code ? 1 : 0 };
}

export async function getInstanceState() {
  try {
    const { data } = await http.get(`/api/sessions/${SESSION}`);
    const status = data?.status || 'UNKNOWN';
    const map = {
      WORKING: 'open',
      SCAN_QR_CODE: 'connecting',
      STARTING: 'connecting',
      STOPPED: 'close',
      FAILED: 'close',
    };
    return {
      instance: {
        instanceName: SESSION,
        state: map[status] || status.toLowerCase(),
        rawStatus: status,
      },
    };
  } catch (err) {
    if (err.response?.status === 404) {
      return { instance: { instanceName: SESSION, state: 'close' } };
    }
    throw err;
  }
}

// --- Envio ---

export async function sendText(phone, body, options = {}) {
  const payload = {
    session: SESSION,
    chatId: phoneToChatId(phone),
    text: body,
  };
  const { data } = await http.post('/api/sendText', payload);
  log.debug('Mensagem enviada', { phone, id: data?.id });
  return {
    key: { id: data?.id || data?._serialized || null, remoteJid: payload.chatId, fromMe: true },
    message: { conversation: body },
    status: 'SENT',
  };
}

export async function setTyping(phone, on = true) {
  try {
    await http.post(`/api/${SESSION}/presence`, {
      chatId: phoneToChatId(phone),
      presence: on ? 'typing' : 'paused',
    });
  } catch (err) {
    log.debug('Falha setTyping', { err: err.message });
  }
}

export async function sendImage(phone, imageUrl, caption) {
  const payload = {
    session: SESSION,
    chatId: phoneToChatId(phone),
    file: { url: imageUrl },
    caption: caption || '',
  };
  const { data } = await http.post('/api/sendImage', payload);
  return data;
}

// --- Parse de webhook payload ---

export function parseIncomingMessage(payload) {
  // WAHA: { event: 'message', session, payload: { from, body, fromMe, id, timestamp, ... } }
  // O wa-agent recebe wrapper { event: 'messages.upsert', data: {...} } compatível com Evolution
  // Aqui adaptamos os dois formatos.
  let event = payload?.event;
  let data;

  if (event === 'message' || event === 'message.any') {
    data = payload.payload || payload.data;
  } else if (event === 'messages.upsert') {
    data = payload?.data;
  } else {
    return null;
  }

  if (!data) return null;
  if (data.fromMe === true || data.key?.fromMe === true) return null;

  const from = data.from || data.key?.remoteJid;
  const phone = chatIdToPhone(from);
  if (!phone) return null;
  const fromIsLid = isLid(from);

  let body = data.body || data.message?.conversation || data.message?.extendedTextMessage?.text || '';
  let mediaType = null;
  let mediaUrl = null;
  let mediaMimetype = null;

  if (data.hasMedia || data.media) {
    mediaMimetype = data.mimetype || data.media?.mimetype || null;
    mediaType = mediaMimetype || 'unknown';
    mediaUrl = data.media?.url || data.mediaUrl || null;
    body = data.caption || body || '[midia]';
  } else if (data.message?.imageMessage) {
    mediaType = 'image';
    body = data.message.imageMessage.caption || '[imagem]';
  } else if (data.message?.audioMessage) {
    mediaType = 'audio';
    body = '[audio]';
  } else if (data.message?.videoMessage) {
    mediaType = 'video';
    body = data.message.videoMessage.caption || '[video]';
  }

  const ts = data.timestamp || data.messageTimestamp;
  return {
    phone,
    fromIsLid,
    pushName: data.notifyName || data._data?.notifyName || data.pushName || null,
    body,
    mediaType,
    mediaUrl,
    mediaMimetype,
    evolutionMessageId: data.id || data.key?.id,
    timestamp: ts ? new Date(Number(ts) * 1000) : new Date(),
  };
}

// Baixa media direto pelo URL retornado no webhook.
// WAHA noweb manda URL interna do proprio container (http://localhost:3000/...)
// que nao funciona de fora — reescreve pra WAHA_API_URL configurado.
function rewriteMediaUrl(url) {
  if (!url || !BASE) return url;
  try {
    const u = new URL(url);
    const internalHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal'];
    if (internalHosts.includes(u.hostname)) {
      const base = BASE.replace(/\/+$/, '');
      const newUrl = `${base}${u.pathname}${u.search}`;
      return newUrl;
    }
    return url;
  } catch {
    return url;
  }
}

export async function downloadMediaFromUrl(url, mimetypeHint) {
  if (!url) return null;
  const fetchUrl = rewriteMediaUrl(url);
  try {
    const resp = await http.get(fetchUrl, { responseType: 'arraybuffer', timeout: 20000 });
    const buffer = Buffer.from(resp.data);
    const mimetype = resp.headers?.['content-type'] || mimetypeHint || 'application/octet-stream';
    log.debug('Media baixada', { fetchUrl, bytes: buffer.length, mimetype });
    return { buffer, mimetype };
  } catch (err) {
    log.warn('Falha baixando media', {
      originalUrl: url,
      fetchUrl,
      err: err.message,
      status: err.response?.status,
    });
    return null;
  }
}
