// cadencia.js — Sistema de follow-up automático para leads sem resposta
// Cadência: 24h → 48h → 5d → 15d → 30d → arquiva como frio
//
// Armazena estado no campo `meta` JSON do lead (sem migration nova).
// meta.cadencia = {
//   passo: 0-5,
//   ultimo_followup_em: ISO,   // quando o bot mandou a última mensagem (bot ou followup)
//   proximo_followup_em: ISO,  // quando deve disparar o próximo
//   pausado: bool,             // true se lead respondeu após o último contato
//   total_enviados: 0-5,
// }

import { db } from './storage.js';
import { chat } from './llm.js';
import { log } from './logger.js';

// ── Intervalos de cada passo (em ms) ─────────────────────────────────────────
const PASSOS = [
  null,                         // passo 0 = ainda não houve followup
  24  * 60 * 60 * 1000,        // passo 1: 24h
  48  * 60 * 60 * 1000,        // passo 2: +48h
  5   * 24 * 60 * 60 * 1000,  // passo 3: +5 dias
  15  * 24 * 60 * 60 * 1000,  // passo 4: +15 dias
  30  * 24 * 60 * 60 * 1000,  // passo 5: +30 dias → arquiva depois
];
const TOTAL_PASSOS = 5;

// ── Helpers de meta JSON ──────────────────────────────────────────────────────
function getMeta(phone) {
  const row = db.prepare('SELECT meta FROM leads WHERE phone = ?').get(phone);
  if (!row) return {};
  try { return JSON.parse(row.meta || '{}'); } catch { return {}; }
}

function setMeta(phone, meta) {
  db.prepare('UPDATE leads SET meta = ? WHERE phone = ?')
    .run(JSON.stringify(meta), phone);
}

// ── API pública ───────────────────────────────────────────────────────────────

// Chamado após o bot enviar qualquer mensagem (inicia ou agenda próximo passo).
// Se o lead já está em cadência pausada (respondeu), não reativa.
export function registrarContatoBot(phone) {
  const meta = getMeta(phone);
  const cad  = meta.cadencia || { passo: 0, pausado: false, total_enviados: 0 };

  // Se pausado (lead respondeu recentemente), mantém pausado — só atualiza ultimo_followup
  if (cad.pausado) {
    cad.ultimo_followup_em = new Date().toISOString();
    meta.cadencia = cad;
    setMeta(phone, meta);
    return;
  }

  const proximoPasso = Math.min((cad.passo || 0) + 1, TOTAL_PASSOS);
  const intervaloMs  = PASSOS[proximoPasso];

  cad.ultimo_followup_em  = new Date().toISOString();
  cad.proximo_followup_em = intervaloMs
    ? new Date(Date.now() + intervaloMs).toISOString()
    : null; // passo 5+: sem próximo
  cad.passo           = cad.passo || 0; // passo atual não muda aqui
  cad.total_enviados  = cad.total_enviados || 0;

  meta.cadencia = cad;
  setMeta(phone, meta);
}

// Chamado quando o lead envia qualquer mensagem — pausa a cadência.
export function pausarCadencia(phone) {
  const meta = getMeta(phone);
  if (!meta.cadencia) return;
  meta.cadencia.pausado           = true;
  meta.cadencia.proximo_followup_em = null;
  setMeta(phone, meta);
}

// Retorna lista de leads que precisam de follow-up agora.
// Filtra: pausado=false, proximo_followup_em <= agora, passo < TOTAL_PASSOS,
//         não tem human_takeover ativo, status != opt_out
export function getLeadsPendentesFollowup() {
  const agora = new Date().toISOString();
  const rows  = db.prepare(`
    SELECT phone, name, meta FROM leads
    WHERE last_whatsapp_at IS NOT NULL
    ORDER BY last_whatsapp_at DESC
    LIMIT 500
  `).all();

  return rows.filter(r => {
    let m = {};
    try { m = JSON.parse(r.meta || '{}'); } catch { return false; }

    const cad = m.cadencia;
    if (!cad) return false;
    if (cad.pausado) return false;
    if (!cad.proximo_followup_em) return false;
    if (cad.proximo_followup_em > agora) return false;
    if ((cad.passo || 0) >= TOTAL_PASSOS) return false;

    // Não dispara se human_takeover ativo
    if (m.human_takeover_until && new Date(m.human_takeover_until) > new Date()) return false;

    return true;
  }).map(r => {
    const m   = JSON.parse(r.meta || '{}');
    return { phone: r.phone, name: r.name, cadencia: m.cadencia };
  });
}

// Avança o passo da cadência após enviar um follow-up.
export function avancarPasso(phone) {
  const meta = getMeta(phone);
  const cad  = meta.cadencia || { passo: 0, total_enviados: 0 };

  const novoPasso = (cad.passo || 0) + 1;
  cad.passo          = novoPasso;
  cad.total_enviados = (cad.total_enviados || 0) + 1;
  cad.ultimo_followup_em = new Date().toISOString();

  // Agenda próximo passo ou encerra
  if (novoPasso < TOTAL_PASSOS) {
    cad.proximo_followup_em = new Date(Date.now() + PASSOS[novoPasso + 1]).toISOString();
  } else {
    // Último passo enviado — arquiva como frio
    cad.proximo_followup_em = null;
    cad.arquivado_em        = new Date().toISOString();
    log.info('Lead arquivado como frio após cadência completa', { phone, passos: novoPasso });
  }

  meta.cadencia = cad;
  setMeta(phone, meta);
}

// ── Geração da mensagem de follow-up ─────────────────────────────────────────

const TOM_POR_PASSO = [
  '', // 0 — não usado
  'Retome o assunto de forma natural e leve, como se fosse uma continuação casual da conversa. Pergunte se ainda tem interesse ou se surgiu alguma dúvida.',
  'Mude o ângulo: destaque um benefício diferente do que já foi falado, ou mencione algo sobre a região/oportunidade. Feche pedindo a opinião do lead.',
  'Use prova social ou contexto de mercado (ex: "outros clientes que visitaram gostaram de X"). Pergunte diretamente o que faria o lead tomar uma decisão.',
  'Tom mais direto: diga que quer entender o timing do lead. Pergunte se ainda faz sentido falar sobre o imóvel ou se a prioridade mudou.',
  'Último contato da série. Seja honesto: diga que não vai continuar incomodando, mas que se o interesse voltar pode contar com você. Deixe a porta aberta.',
];

export async function gerarMensagemFollowup({ phone, name, passo, historico }) {
  const tom = TOM_POR_PASSO[passo] || TOM_POR_PASSO[1];

  const histStr = historico
    .slice(-8)
    .map(m => `${m.direction === 'in' ? (name || 'Lead') : 'Igor (bot)'}: ${(m.body || '').slice(0, 200)}`)
    .join('\n');

  const prompt = `Você é Igor Babolin, corretor de imóveis no litoral de Santa Catarina.
Você está fazendo um follow-up (passo ${passo} de ${TOTAL_PASSOS}) com um lead que não respondeu desde o último contato.

Histórico recente da conversa:
${histStr || '(sem histórico)'}

Instruções para a mensagem de follow-up:
- ${tom}
- Máximo 3 frases curtas — mensagem de WhatsApp, não email
- Tom humano, não robótico, sem floreio excessivo
- NÃO mencione que é um follow-up automático ou que o bot mandou
- NÃO use saudações formais como "Prezado"
- Pode começar pelo nome do lead se souber: "${name || ''}"
- Escreva APENAS a mensagem, sem explicações adicionais`;

  try {
    const resposta = await chat([{ role: 'user', content: prompt }], {
      model: process.env.GROQ_MODEL_TEXT || 'llama-3.1-8b-instant',
      maxTokens: 200,
      temperature: 0.7,
    });
    return resposta?.trim() || null;
  } catch (e) {
    log.error('Falha ao gerar mensagem de followup', { phone, passo, err: e.message });
    return null;
  }
}
