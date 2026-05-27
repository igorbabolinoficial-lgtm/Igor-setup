// parent-api.js — Cliente HTTP pro igor-neural-system (parent).
// Usado pra chamadas que dependem das integracoes Google (Calendar, Sheets, Drive, Gmail).
// Auth: X-Agent-Token (env IGOR_AGENT_TOKEN) ja que esses endpoints sao protegidos.

import { log } from './logger.js';

const PARENT_URL = process.env.PARENT_API_URL || 'https://imobiliariapraiadorosa.com.br';
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

async function chamarParentGet(path) {
  if (!AGENT_TOKEN) return { ok: false, error: 'IGOR_AGENT_TOKEN nao configurado' };
  try {
    const r = await fetch(`${PARENT_URL}${path}`, {
      method: 'GET',
      headers: { 'X-Agent-Token': AGENT_TOKEN },
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return { ok: false, status: r.status, data };
    return { ok: true, status: r.status, data };
  } catch (e) {
    log.error('Falha chamando parent API (GET)', { path, err: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Cria evento na agenda do parent (que tambem cria evento no Google Calendar via OAuth).
 * Retorna { ok, data } onde data tem google_sync.link / google_sync.meet se Google OK.
 */
// tipo: 'reuniao' (visita presencial) | 'ligacao' (call/Google Meet)
export async function criarAgenda({ titulo, descricao, lead_id, lead_phone, inicio, fim, tipo = 'reuniao', convidados, localizacao, cancelar_anterior_event_id }) {
  return chamarParent('/api/agenda', {
    titulo,
    descricao,
    lead_id,
    lead_phone,
    inicio,
    fim,
    tipo,
    convidados,
    localizacao,
    cancelar_anterior_event_id,
  });
}

/**
 * Sincroniza lead novo com o parent (cria no DB do parent + append na Sheet via OAuth).
 * Best-effort: silencioso se falhar.
 */
export async function criarLead({ nome, telefone, origem = 'whatsapp', interesse, mensagem }) {
  return chamarParent('/api/leads', {
    nome,
    telefone,
    origem,
    interesse: interesse || '',
    notas: mensagem || '',
  });
}

/**
 * Atualiza status do lead no pipeline pelo telefone (best-effort, nunca regride).
 * @param {{ telefone: string, status: 'em_atendimento'|'qualificado'|'convertido' }} args
 */
export async function atualizarStatusLead({ telefone, status, pontos }) {
  return chamarParent('/api/leads/by-phone/status', { telefone, status, ...(typeof pontos === 'number' ? { pontos } : {}) });
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

/**
 * Busca bloco formatado de treinamento pra injetar no system prompt.
 * Retorna string vazia se nao houver conteúdo ativo ou parent indisponível.
 */
export async function fetchContextoTreino() {
  return chamarParentGet('/api/treinamento-contexto');
}

export function parentReady() {
  return !!AGENT_TOKEN;
}
