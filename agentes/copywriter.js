// Copywriter — especialista em texto. Recebe briefing do Estrategista ou pede direto.

const { db } = require('../db');
const { gerarTexto, temAlgumLLM } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

module.exports = {
    chave: 'copywriter',
    descricao: 'Escreve posts, headlines, captions',
    tiposAceitos: ['escrever_post', 'gerar_headline', 'reescrever'],

    async executar({ tipo, payload }) {
        if (!temAlgumLLM()) return { texto: 'Sem LLM' };
        const dna = contextoDNA(1500);

        if (tipo === 'escrever_post') {
            const imovel = payload.imovel_id ? db.prepare('SELECT * FROM imoveis WHERE id = ?').get(payload.imovel_id) : null;
            const angulo = payload.angulo || '';
            const formato = payload.formato || 'instagram-post';
            const prompt = `Você é o Copywriter do Igor Babolin (Praia do Rosa - SC). Escreve texto que VENDE sem clichê.

${dna}

# BRIEFING
Formato: ${formato}
${angulo ? `Ângulo único: ${angulo}` : ''}
${imovel ? `Imóvel: ${imovel.titulo} | ${imovel.tipo || '-'} | ${imovel.bairro || '-'} | R$ ${imovel.preco || '?'}` : ''}
${payload.objetivo ? `Objetivo: ${payload.objetivo}` : ''}

# REGRAS
- Hook nas 2 primeiras linhas (observação concreta, não "Conheça")
- 4-6 parágrafos curtos
- ZERO: "imperdível", "cantinho do paraíso", "viva o sonho"
- Máx 3 emojis no post inteiro
- CTA único e claro no fim

Texto:`;
            const r = await gerarTexto(prompt);
            heartbeat('copywriter');
            return { texto: r?.texto, modelo: r?.modelo, imovel_id: imovel?.id };
        }

        if (tipo === 'gerar_headline') {
            const prompt = `Você é o Copywriter do Igor Babolin. Gere 5 opções de HEADLINE pra: ${payload.tema || 'imóvel genérico'}. Cada uma max 80 chars. Sem clichê. Devolva 1 por linha, numeradas.

${dna}

Headlines:`;
            const r = await gerarTexto(prompt);
            heartbeat('copywriter');
            return { headlines: r?.texto, modelo: r?.modelo };
        }

        if (tipo === 'reescrever') {
            const prompt = `Você é o Copywriter do Igor Babolin. Reescreva o texto abaixo eliminando: clichê, jargão genérico, palavras-ônibus. Tom direto, profissional.

${dna}

TEXTO ORIGINAL:
${payload.texto || '-'}

DIREÇÃO: ${payload.direcao || 'mais direto, menos floreio'}

Texto reescrito:`;
            const r = await gerarTexto(prompt);
            heartbeat('copywriter');
            return { texto: r?.texto, modelo: r?.modelo };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
