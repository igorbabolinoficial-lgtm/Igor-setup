// Estrategista — define calendário editorial e briefings de campanha pros outros agentes.

const { db, registrarLog } = require('../db');
const { gerarTexto, temAlgumLLM, extrairJson } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

module.exports = {
    chave: 'estrategista',
    descricao: 'Calendário editorial e briefing por campanha',
    tiposAceitos: ['planejar_calendario', 'briefing_campanha', 'definir_angulo'],

    async executar({ tipo, payload }) {
        if (tipo === 'planejar_calendario') {
            if (!temAlgumLLM()) return { plano: 'Sem LLM' };
            const dna = contextoDNA(1500);
            const periodo = payload.dias || 30;
            const totalImoveis = db.prepare('SELECT COUNT(*) AS n FROM imoveis WHERE preco > 0').get().n;
            const prompt = `Você é o Estrategista de Marketing do Igor Babolin (Praia do Rosa - SC). Planeje calendário editorial de ${periodo} dias.

${dna}

# CONTEXTO
- Catálogo: ${totalImoveis} imóveis disponíveis
- Audiência: investidores SP+SC, casais aposentados, famílias buscando segunda residência
- Canais: Instagram (3x/dia), WhatsApp (broadcasts pontuais)

Devolva JSON estrito (sem texto antes/depois):
{
  "tema_mes": "tema central do mês (ex: 'Investir na Praia do Rosa')",
  "pilares": ["3-4 pilares de conteúdo"],
  "campanhas": [{"nome":"...", "dias":"1-7", "objetivo":"...", "tipo_conteudo":["post","reel","story"]}],
  "kpis": ["3 KPIs principais"]
}`;
            const r = await gerarTexto(prompt);
            const json = r ? extrairJson(r.texto) : null;
            heartbeat('estrategista');
            return { plano: json || { erro: 'IA não retornou JSON', raw: r?.texto?.slice(0, 300) }, modelo: r?.modelo };
        }

        if (tipo === 'briefing_campanha') {
            if (!temAlgumLLM()) return { briefing: 'Sem LLM' };
            const dna = contextoDNA(1500);
            const prompt = `Você é o Estrategista do Igor Babolin. Crie briefing executivo pra campanha: "${payload.tema || 'genérica'}". 5 seções: Objetivo, Audiência, Mensagem central, Formatos (post/reel/story/anúncio), KPIs. Pt-BR direto.

${dna}

Briefing:`;
            const r = await gerarTexto(prompt);
            heartbeat('estrategista');
            return { briefing: r?.texto, modelo: r?.modelo };
        }

        if (tipo === 'definir_angulo') {
            // Pra cada imóvel/lead, sugere ângulo único pra Copywriter usar
            if (!temAlgumLLM()) return { angulo: 'Sem LLM' };
            const imovel = payload.imovel_id ? db.prepare('SELECT * FROM imoveis WHERE id = ?').get(payload.imovel_id) : null;
            const prompt = `Você é o Estrategista do Igor Babolin. Sugira ÂNGULO ÚNICO (não óbvio) pra divulgar este imóvel. Foque no que NÃO é template ("casa lindíssima"). 2 linhas máx.

Imóvel: ${imovel?.titulo || payload.tema || '-'}
Tipo: ${imovel?.tipo || '-'} | Bairro: ${imovel?.bairro || '-'} | Preço: ${imovel?.preco || '-'}
Descrição: ${imovel?.descricao?.slice(0, 300) || '-'}

Ângulo único:`;
            const r = await gerarTexto(prompt);
            heartbeat('estrategista');
            return { angulo: r?.texto, imovel_id: imovel?.id };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
