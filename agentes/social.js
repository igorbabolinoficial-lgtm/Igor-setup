const { db, uid } = require('../db');
const { gerarTexto, temAlgumLLM, extrairJson } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

function fmtBRL(v) {
    return v ? `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : 'sob consulta';
}

function escolherImovel(temaPreferido) {
    const where = ['preco > 0'];
    const params = [];
    if (temaPreferido) {
        where.push('(LOWER(titulo) LIKE ? OR LOWER(tipo) LIKE ? OR LOWER(bairro) LIKE ?)');
        const like = `%${temaPreferido.toLowerCase()}%`;
        params.push(like, like, like);
    }
    return db.prepare(`
        SELECT id, slug, titulo, preco, tipo, bairro, quartos, area_m2, descricao
        FROM imoveis WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT 1
    `).get(...params);
}

async function gerarPostComIA(imovel, tema) {
    if (!imovel) return null;
    const dna = contextoDNA(1800);
    const prompt = `Você é o Social Media sênior da imobiliária Igor Babolin (Praia do Rosa - SC). Não é estagiário. Crie um post Instagram que vende.

${dna ? `# DNA DA IMOBILIÁRIA (do Cérebro Obsidian — tom, audiência, posicionamento)\n${dna}\n` : ''}
# IMÓVEL ALVO
${imovel.titulo}
Tipo: ${imovel.tipo || '-'} · Bairro: ${imovel.bairro || 'Praia do Rosa'} · Preço: ${fmtBRL(imovel.preco)}
${imovel.quartos ? 'Quartos: ' + imovel.quartos + ' · ' : ''}${imovel.area_m2 ? 'Área: ' + imovel.area_m2 + 'm²' : ''}
${imovel.descricao ? 'Detalhes: ' + imovel.descricao.slice(0, 300) : ''}

# REGRAS DE OURO
- Hook nas 2 primeiras linhas: NÃO comece com "Você sabia", "Conheça", "Apresentando". Comece com uma observação concreta (lugar, número, sensação).
- 4-6 parágrafos curtos (1-2 linhas cada).
- Foca no que ESTE imóvel tem de não-óbvio (ângulo único, vista, detalhe construtivo, posição na praia).
- CTA único e claro no fim ("comenta EU", "DM com 'rosa'", etc).
- Máximo 3 emojis no post inteiro. Se duvidar, tira.
- ZERO: "imperdível", "sua oportunidade", "não perca", "cantinho do paraíso", "viva o sonho".

RESPONDA EM JSON ESTRITO (nada antes nem depois):
{"titulo": "headline curto até 60 chars", "copy": "post completo com quebras \\n\\n", "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]}`;

    const r = await gerarTexto(prompt);
    if (!r) return null;
    const json = extrairJson(r.texto);
    if (!json || !json.copy) return null;
    return { ...json, modelo: r.modelo };
}

module.exports = {
    chave: 'social',
    descricao: 'Cria/agenda posts e responde DMs',
    tiposAceitos: ['gerar_post', 'agendar_post', 'responder_dm'],

    async executar({ tipo, payload }) {
        if (tipo === 'gerar_post') {
            // 1) Escolher imóvel (usa payload.imovel_id se vier; senão sorteia por tema)
            let imovel = null;
            if (payload.imovel_id) {
                imovel = db.prepare('SELECT * FROM imoveis WHERE id = ?').get(payload.imovel_id);
            }
            if (!imovel) imovel = escolherImovel(payload.tema);

            // 2) Gerar copy via IA (se disponível)
            if (temAlgumLLM() && imovel) {
                const post = await gerarPostComIA(imovel, payload.tema);
                if (post) {
                    heartbeat('social');
                    return {
                        imovel_id: imovel.id,
                        titulo: post.titulo,
                        copy: post.copy,
                        hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
                        modelo: post.modelo,
                        status: 'rascunho_ia'
                    };
                }
            }

            // 3) Fallback simples (sem IA)
            const titulo = imovel ? `${imovel.titulo} — ${fmtBRL(imovel.preco)}` : `Post ${new Date().toLocaleDateString('pt-BR')}`;
            return {
                imovel_id: imovel && imovel.id,
                titulo,
                copy: imovel
                    ? `${imovel.titulo}\n\n${imovel.tipo || 'Imóvel'} ${imovel.bairro ? 'em ' + imovel.bairro : ''} por ${fmtBRL(imovel.preco)}.\n\nQuer saber mais? Manda DM!`
                    : `Imóveis selecionados na Praia do Rosa. Fala com a gente!`,
                hashtags: ['#PraiaDoRosa', '#ImoveisPraiaDoRosa', '#BabolinImoveis'],
                status: 'rascunho_fallback'
            };
        }

        if (tipo === 'agendar_post') {
            const id = uid('evt');
            db.prepare(`
                INSERT INTO agenda (id, titulo, descricao, inicio, tipo)
                VALUES (?, ?, ?, ?, 'post')
            `).run(id, payload.titulo || 'Post agendado', payload.copy || '', payload.quando);
            return { evento_id: id, agendado_para: payload.quando };
        }

        if (tipo === 'responder_dm') {
            // Resposta IA contextualizada quando temos o lead
            let contextoLead = '';
            if (payload.lead_id) {
                const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
                if (lead) contextoLead = `O lead se chama ${lead.nome}. Interesse: ${lead.interesse || '-'}. Status: ${lead.status}.`;
            }
            const mensagem = payload.mensagem || '(sem mensagem)';

            if (temAlgumLLM()) {
                const dna = contextoDNA(1200);
                const r = await gerarTexto(`Você é o atendente do Igor Babolin Imóveis (Praia do Rosa - SC). Responda esta DM em até 3 linhas, em pt-BR.

${dna ? `# TOM DA CASA\n${dna}\n` : ''}
${contextoLead ? `# LEAD\n${contextoLead}\n` : ''}
# DM RECEBIDA
${mensagem}

REGRAS:
- Tom: vendedor de praia, próximo. NÃO corporate.
- Se a pessoa perguntou algo específico, responde a pergunta. NÃO desvia.
- Se ainda não tem nome/telefone, pede UM dos dois (não os dois de uma vez).
- ZERO emoji. ZERO "estamos à disposição".

Resposta (texto puro):`);
                if (r) { heartbeat('social'); return { dm_id: payload.dm_id, resposta: r.texto, modelo: r.modelo, status: 'rascunho_ia' }; }
            }

            return { dm_id: payload.dm_id, resposta: 'Olá! Recebi sua mensagem, em breve respondo com mais detalhes.', status: 'rascunho_fallback' };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
