module.exports = {
    chave: 'financeiro',
    descricao: 'Categoriza transações bancárias e monta relatórios',
    tiposAceitos: ['classificar_tx', 'relatorio_dre'],

    async executar({ tipo, payload }) {
        if (tipo === 'classificar_tx') {
            const desc = (payload.descricao || '').toLowerCase();
            let categoria = 'outros';
            if (/aluguel|condom|iptu/.test(desc))   categoria = 'imovel';
            else if (/uber|99|taxi|combust/.test(desc)) categoria = 'transporte';
            else if (/mercado|ifood|restau/.test(desc)) categoria = 'alimentacao';
            else if (/anuncio|ads|meta|google/.test(desc)) categoria = 'marketing';
            else if (/comissao|venda|recebimento/.test(desc)) categoria = 'receita';
            return { tx_id: payload.tx_id, categoria, valor: payload.valor };
        }

        if (tipo === 'relatorio_dre') {
            return { periodo: payload.periodo || 'mes_atual', status: 'mock_relatorio_gerado' };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
