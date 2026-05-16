const { db } = require('../db');

function decodeFotos(linha) {
    return { ...linha, fotos: linha.fotos ? JSON.parse(linha.fotos) : [] };
}

module.exports = {
    chave: 'pesquisa',
    descricao: 'Inteligência de mercado: preços, concorrência, sugestão de imóveis',
    tiposAceitos: ['pesquisar_mercado', 'monitorar_concorrencia', 'sugerir_imovel'],

    async executar({ tipo, payload }) {
        if (tipo === 'pesquisar_mercado') {
            const stats = db.prepare(`
                SELECT COUNT(*) AS total,
                       AVG(preco) AS preco_medio,
                       MIN(preco) AS minimo,
                       MAX(preco) AS maximo
                FROM imoveis WHERE preco > 0
            `).get();
            const porTipo = db.prepare(`
                SELECT tipo, COUNT(*) AS n FROM imoveis GROUP BY tipo ORDER BY n DESC
            `).all();
            return {
                regiao: payload.regiao || 'Praia do Rosa',
                imoveis_disponiveis: stats.total,
                preco_medio: Math.round(stats.preco_medio || 0),
                preco_min:   stats.minimo,
                preco_max:   stats.maximo,
                distribuicao_tipo: porTipo,
                fonte: 'banco_local'
            };
        }

        if (tipo === 'sugerir_imovel') {
            const orcamento = Number(payload.orcamento) || Infinity;
            const tipoFiltro = payload.tipo;
            const where = ['preco > 0', 'preco <= ?'];
            const params = [orcamento];
            if (tipoFiltro) { where.push('tipo = ?'); params.push(tipoFiltro); }
            const sugestoes = db.prepare(`
                SELECT id, slug, titulo, preco, tipo, bairro, fotos, url_origem
                FROM imoveis
                WHERE ${where.join(' AND ')}
                ORDER BY preco DESC
                LIMIT 5
            `).all(...params).map(decodeFotos);
            return { orcamento, total: sugestoes.length, sugestoes };
        }

        if (tipo === 'monitorar_concorrencia') {
            return { concorrente: payload.concorrente, atividade: 'baixa', status: 'mock' };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
