// lib/analista-conversas.js — Auto-crítica do bot.
// Lê conversas do WhatsApp, audita com LLM (mesma análise que um humano faria),
// salva os erros e acumula "regras aprendidas" que o operador aprova pra entrar no prompt.
'use strict';

const { db, uid, nowIso, registrarLog } = require('../db');
const { gerarTexto, extrairJson } = require('../agentes/ia');

// Catálogo de erros que o bot comete (destilado da conversa do Oscar). O auditor
// só pode usar estas chaves — assim a recorrência é mensurável.
const TIPOS_ERRO = {
    repetiu_pergunta:    'Perguntou algo que o lead já tinha respondido no histórico.',
    nao_mostrou_imovel:  'Lead deu critérios (tipo/região/preço) mas o bot não mandou nenhuma opção de imóvel.',
    negou_existente:     'Disse que não tem imóvel quando existe um que bate (no catálogo/busca).',
    ignorou_midia:       'Lead mandou imagem ou link e o bot não leu / disse que não conseguiu ver.',
    ligacao_mal_tratada: 'Lead tentou ligar e o bot não seguiu o protocolo (avisar que não atende + pedir pro Igor ligar).',
    fallback_indevido:   'Mandou "Desculpa, não peguei" para uma mensagem que era clara.',
    repetitivo_robotico: 'Ecoou/parafraseou o lead ou ficou repetitivo e robótico.',
    nao_avancou:         'Ficou só coletando dados sem avançar pra mostrar imóvel ou agendar.',
};

function waFetch(path) {
    const url = process.env.WA_AGENT_URL, token = process.env.WA_AGENT_TOKEN;
    if (!url || !token) return Promise.resolve(null);
    return fetch(`${url}${path}`, { headers: { 'x-webhook-token': token, 'Content-Type': 'application/json' } })
        .then(r => r.ok ? r.json() : null).catch(() => null);
}

function formatarConversa(mensagens) {
    return mensagens
        .filter(m => m.body && String(m.body).trim())
        .map(m => `${m.direction === 'in' ? 'LEAD' : 'BOT'}: ${String(m.body).slice(0, 400)}`)
        .join('\n');
}

function montarPromptAuditoria(conversa) {
    const tiposTxt = Object.entries(TIPOS_ERRO).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    return `Você é auditor de qualidade de um bot de vendas imobiliárias (o "Babolin", assistente do corretor Igor).
Analise a conversa abaixo e identifique ONDE o bot errou. Seja rigoroso mas justo — só aponte erro real.

TIPOS DE ERRO (use SOMENTE estas chaves):
${tiposTxt}

Responda SOMENTE com JSON puro:
{"score": N, "resumo": "1 frase", "erros": [{"tipo": "chave_do_erro", "gravidade": "alta|media|baixa", "trecho": "trecho curto da conversa", "sugestao": "regra curta e acionável que evitaria isso no futuro"}]}

REGRAS:
- score: 0 a 10 (qualidade geral da condução; 10 = impecável).
- erros: lista vazia [] se o bot foi bem. Não invente erro.
- "sugestao": escreva como uma INSTRUÇÃO pro bot (ex: "Quando o lead disser o tipo e a região, mande logo 2-3 opções com link"). Curta.

CONVERSA:
${conversa}

JSON:`;
}

// Audita uma conversa já carregada (mensagens = [{direction, body, ...}]). Salva e propõe regras.
async function analisarMensagens(phone, leadNome, mensagens, ultimaMsgAt) {
    const conversa = formatarConversa(mensagens);
    if (conversa.length < 40) return { ok: false, motivo: 'conversa curta' };

    const r = await gerarTexto(montarPromptAuditoria(conversa), { modelo: 'llama-3.3-70b-versatile' });
    if (!r) return { ok: false, motivo: 'LLM indisponível' };

    let aud = null;
    try { aud = JSON.parse(r.texto.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()); }
    catch { aud = extrairJson(r.texto); }
    if (!aud || !Array.isArray(aud.erros)) return { ok: false, motivo: 'JSON inválido' };

    // Salva a análise
    db.prepare(`INSERT INTO analises_conversa (phone, lead_nome, score, erros, resumo, ultima_msg_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(phone, leadNome || null, Number(aud.score) || 0, JSON.stringify(aud.erros), aud.resumo || '', ultimaMsgAt || null);

    // Acumula cada erro como regra proposta (upsert por tipo)
    for (const e of aud.erros) {
        if (!TIPOS_ERRO[e.tipo] || !e.sugestao) continue;
        const exist = db.prepare('SELECT * FROM regras_propostas WHERE tipo_erro = ?').get(e.tipo);
        if (exist) {
            if (exist.status === 'rejeitada') continue; // não ressuscita rejeitada
            const exemplos = (() => { try { return JSON.parse(exist.exemplos || '[]'); } catch { return []; } })();
            exemplos.push({ phone, trecho: e.trecho || '', quando: nowIso() });
            db.prepare(`UPDATE regras_propostas SET ocorrencias = ocorrencias + 1, exemplos = ?, atualizado_em = ?
                        WHERE id = ?`).run(JSON.stringify(exemplos.slice(-8)), nowIso(), exist.id);
        } else {
            db.prepare(`INSERT INTO regras_propostas (tipo_erro, regra, ocorrencias, exemplos)
                        VALUES (?, ?, 1, ?)`)
              .run(e.tipo, e.sugestao, JSON.stringify([{ phone, trecho: e.trecho || '', quando: nowIso() }]));
        }
    }

    return { ok: true, score: aud.score, erros: aud.erros, resumo: aud.resumo };
}

// Busca a conversa do lead no wa-agent e analisa.
async function analisarConversa(phone) {
    const data = await waFetch(`/admin/conversas/${phone}?limit=60`);
    const mensagens = data?.mensagens || data?.messages || (Array.isArray(data) ? data : []);
    if (!mensagens.length) return { ok: false, motivo: 'sem mensagens' };
    const ultimaMsgAt = mensagens[mensagens.length - 1]?.created_at || mensagens[mensagens.length - 1]?.at || null;
    const leadNome = data?.lead?.name || null;
    return analisarMensagens(phone, leadNome, mensagens, ultimaMsgAt);
}

// Conversas que esfriaram (sem msg há 30min+) e ainda não analisadas nesse estado.
async function analisarEsfriadas({ limite = 5 } = {}) {
    const data = await waFetch('/admin/leads');
    const leads = data?.leads || [];
    const agora = Date.now();
    const candidatos = leads.filter(l => {
        const lastAt = l.last_at ? new Date(l.last_at).getTime() : 0;
        if (!lastAt || agora - lastAt < 30 * 60 * 1000) return false; // ainda quente
        // já analisada com essa última msg?
        const ja = db.prepare('SELECT ultima_msg_at FROM analises_conversa WHERE phone = ? ORDER BY id DESC LIMIT 1').get(l.phone);
        if (ja && ja.ultima_msg_at && new Date(ja.ultima_msg_at).getTime() >= lastAt) return false;
        return true;
    }).slice(0, limite);

    let feitas = 0;
    for (const l of candidatos) {
        try { const r = await analisarConversa(l.phone); if (r.ok) feitas++; } catch {}
    }
    if (feitas) registrarLog({ agente: 'analista', nivel: 'info', mensagem: `Analista auditou ${feitas} conversa(s) encerrada(s)` });
    return { feitas, candidatos: candidatos.length };
}

// Aprova uma regra → vira item de treinamento ativo (entra no prompt do bot).
function aprovarRegra(id) {
    const regra = db.prepare('SELECT * FROM regras_propostas WHERE id = ?').get(id);
    if (!regra) return { ok: false, motivo: 'não encontrada' };
    const treinoId = uid('treino');
    db.prepare(`INSERT INTO treinamento (id, categoria, nome, tipo, conteudo, ativo)
                VALUES (?, 'regras', ?, 'texto', ?, 1)`)
      .run(treinoId, `Correção: ${regra.tipo_erro}`, regra.regra);
    db.prepare(`UPDATE regras_propostas SET status = 'aprovada', treino_id = ?, atualizado_em = ? WHERE id = ?`)
      .run(treinoId, nowIso(), id);
    registrarLog({ agente: 'analista', nivel: 'sucesso', mensagem: `Regra aprovada e ativada no bot: ${regra.tipo_erro}` });
    return { ok: true, treino_id: treinoId };
}

function rejeitarRegra(id) {
    const regra = db.prepare('SELECT * FROM regras_propostas WHERE id = ?').get(id);
    if (!regra) return { ok: false, motivo: 'não encontrada' };
    if (regra.treino_id) db.prepare('UPDATE treinamento SET ativo = 0 WHERE id = ?').run(regra.treino_id);
    db.prepare(`UPDATE regras_propostas SET status = 'rejeitada', atualizado_em = ? WHERE id = ?`).run(nowIso(), id);
    return { ok: true };
}

module.exports = { analisarConversa, analisarMensagens, analisarEsfriadas, aprovarRegra, rejeitarRegra, TIPOS_ERRO };
