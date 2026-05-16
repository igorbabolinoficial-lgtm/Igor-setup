// Community Manager — DMs e comentários no Insta/WhatsApp. Escala humano quando preciso.

const { db, registrarLog } = require('../db');
const { gerarTexto, temAlgumLLM } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

// Critérios pra escalar pra humano (Igor real). Volta string ou null.
function deveEscalar(mensagem, lead) {
    const m = (mensagem || '').toLowerCase();
    if (/(jurid|advoga|cancel|reclama[çc]|process|denunc|policia)/.test(m)) return 'jurídico/reclamação';
    if (/(urgent|hoje mesmo|agora|imediato)/.test(m)) return 'urgência';
    if (/(propost|valor|negoc|desconto|abat|barganh)/.test(m)) return 'negociação';
    if (lead && lead.score_ia >= 85) return 'lead quente';
    return null;
}

module.exports = {
    chave: 'community_manager',
    descricao: 'Responde DMs e comentários, escalonamento humano',
    tiposAceitos: ['responder_dm', 'responder_comentario', 'escalonar'],

    async executar({ tipo, payload }) {
        const dna = contextoDNA(1200);

        if (tipo === 'responder_dm') {
            const lead = payload.lead_id ? db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id) : null;
            const motivoEscalar = deveEscalar(payload.mensagem, lead);

            if (motivoEscalar) {
                // Notifica humano via Telegram + marca pra revisão
                try {
                    const { notificar } = require('../bot');
                    notificar(`*Community: escalonando humano* (${motivoEscalar})\n\n${lead ? `Lead: ${lead.nome}\n` : ''}DM: ${(payload.mensagem || '').slice(0, 400)}`).catch(() => {});
                } catch {}
                registrarLog({ agente: 'community_manager', nivel: 'alerta', mensagem: `Escalou DM pra humano: ${motivoEscalar}`, contexto: { lead_id: lead?.id, mensagem: payload.mensagem } });
                heartbeat('community_manager');
                return { resposta: null, escalado: true, motivo: motivoEscalar };
            }

            if (!temAlgumLLM()) return { resposta: 'Oi, recebi sua mensagem. Em breve te respondo com mais detalhes.', escalado: false };
            const ctx = lead ? `Lead: ${lead.nome}, interesse: ${lead.interesse || '-'}, status: ${lead.status}` : 'Lead anônimo';
            const prompt = `Você é o Community Manager do Igor Babolin (Praia do Rosa). Responde DM em 3 linhas máx, tom acolhedor não-corporate.

${dna}

# LEAD
${ctx}

# DM
${payload.mensagem || '-'}

Resposta:`;
            const r = await gerarTexto(prompt);
            heartbeat('community_manager');
            return { resposta: r?.texto, modelo: r?.modelo, escalado: false };
        }

        if (tipo === 'responder_comentario') {
            if (!temAlgumLLM()) return { resposta: 'Comenta DM que te respondo direto 👀' };
            const prompt = `Você é o Community Manager do Igor Babolin. Comentário público no Insta. Responde em 1 linha (máx 200 chars), simpático mas profissional. Convida pra DM se for pergunta específica.

${dna}

# COMENTÁRIO
${payload.comentario || '-'}

# CONTEXTO DO POST
${payload.post_contexto || 'imóvel destacado'}

Resposta:`;
            const r = await gerarTexto(prompt);
            heartbeat('community_manager');
            return { resposta: r?.texto, modelo: r?.modelo };
        }

        if (tipo === 'escalonar') {
            try {
                const { notificar } = require('../bot');
                notificar(`*Escalonamento manual*\n\n${payload.motivo || 'sem motivo'}\n\n${payload.contexto || ''}`).catch(() => {});
            } catch {}
            heartbeat('community_manager');
            return { escalado: true };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
