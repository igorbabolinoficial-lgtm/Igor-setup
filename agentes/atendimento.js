module.exports = {
    chave: 'atendimento',
    descricao: 'Pós-venda: documentação, vistoria, dúvidas de cliente',
    tiposAceitos: ['atender_cliente', 'documentacao_pos'],

    async executar({ tipo, payload }) {
        if (tipo === 'atender_cliente') {
            return { lead_id: payload.lead_id, resposta: '[mock] Atendimento registrado', status: 'em_andamento' };
        }
        if (tipo === 'documentacao_pos') {
            return { contrato_id: payload.contrato_id, etapa: payload.etapa || 'inicio', status: 'mock' };
        }
        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
