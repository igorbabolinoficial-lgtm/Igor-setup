// Account Manager — pós-venda. Recebe lead convertido, faz nurturing infinito.

const { db, registrarLog, uid } = require('../db');
const { gerarTexto, temAlgumLLM } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

module.exports = {
    chave: 'account_manager',
    descricao: 'Pós-venda: lembretes, NPS, up-sell, suporte',
    tiposAceitos: ['lembrete_contrato', 'nps', 'upsell', 'suporte_pos'],

    async executar({ tipo, payload }) {
        if (tipo === 'lembrete_contrato') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead nao encontrado`);
            const mensagem = `Oi ${lead.nome.split(' ')[0]}, lembrete: ${payload.evento || 'vencimento próximo'}. Algo que precisa da nossa parte?`;
            heartbeat('account_manager');
            registrarLog({ agente: 'account_manager', nivel: 'info', mensagem: `Lembrete preparado pra ${lead.nome}`, contexto: { lead_id: lead.id, evento: payload.evento } });
            return { lead_id: lead.id, mensagem };
        }

        if (tipo === 'nps') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead nao encontrado`);
            const link = payload.link_avaliacao || 'https://g.page/r/SUA_PAGINA_GOOGLE/review';
            const msg = `${lead.nome.split(' ')[0]}, faz quase um mês desde o seu fechamento. Como tá sendo a experiência? Se puder, deixa uma avaliação aqui: ${link}`;
            heartbeat('account_manager');
            return { lead_id: lead.id, mensagem: msg };
        }

        if (tipo === 'upsell') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead nao encontrado`);
            if (!temAlgumLLM()) return { lead_id: lead.id, sugestao: 'Sem LLM' };

            // Busca 3 imóveis que combinam com perfil
            const tags = lead.tags_ia ? JSON.parse(lead.tags_ia).join(', ') : '';
            const imoveis = db.prepare(`
                SELECT id, titulo, preco, tipo, bairro
                FROM imoveis WHERE preco > 0
                ORDER BY RANDOM() LIMIT 3
            `).all();
            const dna = contextoDNA(1000);
            const prompt = `Você é o Account Manager do Igor Babolin (Praia do Rosa). Lead JÁ converteu (cliente atual). Escreva 1 mensagem curta (4 linhas máx) sugerindo um destes 3 imóveis pra up-sell. Cite só 1 imóvel, o mais relevante pro perfil. Não force a venda — tom de "deixa eu te avisar pq achei que faz sentido".

${dna}

# CLIENTE
${lead.nome} · segmento ${lead.segmento || '-'} · tags ${tags}

# 3 IMÓVEIS CANDIDATOS
${imoveis.map(i => `- ${i.titulo} (${i.tipo || '-'}, ${i.bairro || '-'}) — R$ ${Number(i.preco).toLocaleString('pt-BR')}`).join('\n')}

Mensagem (texto puro):`;
            const r = await gerarTexto(prompt);
            heartbeat('account_manager');
            return { lead_id: lead.id, mensagem: r?.texto, imoveis_candidatos: imoveis.map(i => i.id) };
        }

        if (tipo === 'suporte_pos') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead nao encontrado`);
            // Dispara skill docx pra resposta formal
            const { executarSkill } = require('../bot/skills');
            const r = await executarSkill('docx', `Resposta formal pra cliente ${lead.nome}. Dúvida: ${payload.duvida || 'não informada'}.`, { lead_id: lead.id });
            heartbeat('account_manager');
            return { lead_id: lead.id, resposta: r.output };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
