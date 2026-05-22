// parent-api.js — Cliente HTTP pro igor-neural-system (parent).
// Usado pra chamadas que dependem das integracoes Google (Calendar, Sheets, Drive, Gmail).
// Auth: X-Agent-Token (env IGOR_AGENT_TOKEN) ja que esses endpoints sao protegidos.

import { log } from './logger.js';

const PARENT_URL = process.env.PARENT_API_URL || 'https://babolin.tech';
const AGENT_TOKEN = process.env.IGOR_AGENT_TOKEN || process.env.IGOR_API_TOKEN;

async function chamarParent(path, body) {
  if (!AGENT_TOKEN) {
    return { ok: false, error: 'IGOR_AGENT_TOKEN nao configurado no .env do wa-agent' };
  }
  try {
    const r = await fetch(`${PARENT_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': AGENT_TOKEN,
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      log.warn('Parent API retornou erro', { path, status: r.status, data });
      return { ok: false, status: r.status, data };
    }
    return { ok: true, status: r.status, data };
  } catch (e) {
    log.error('Falha chamando parent API', { path, err: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Cria evento na agenda do parent (que tambem cria evento no Google Calendar via OAuth).
 * Retorna { ok, data } onde data tem google_sync.link / google_sync.meet se Google OK.
 */
export async function criarAgenda({ titulo, descricao, lead_id, inicio, fim, convidados, localizacao }) {
  return chamarParent('/api/agenda', {
    titulo,
    descricao,
    lead_id,
    inicio,
    fim,
    tipo: 'reuniao',
    convidados,
    localizacao,
  });
}

/**
 * Upload de midia pro Google Drive via parent.
 */
export async function uploadMidia({ leadId, nome, mimeType, base64 }) {
  return chamarParent('/api/midia', { leadId, nome, mimeType, base64 });
}

/**
 * Envia email via Gmail do Igor (via parent).
 */
export async function enviarEmail({ to, subject, html, text, replyTo }) {
  return chamarParent('/api/email', { to, subject, html, text, replyTo });
}

export function parentReady() {
  return !!AGENT_TOKEN;
}
