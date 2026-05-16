module.exports = {
    chave: 'designer',
    descricao: 'Gera artes e edita imagens para posts e materiais',
    tiposAceitos: ['gerar_arte', 'editar_imagem'],

    async executar({ tipo, payload }) {
        if (tipo === 'gerar_arte') {
            return {
                briefing: payload.briefing,
                formato: payload.formato || '1080x1080',
                arquivo: `mock://designer/arte_${Date.now()}.png`,
                status: 'pendente_geracao_real'
            };
        }
        if (tipo === 'editar_imagem') {
            return { arquivo_origem: payload.arquivo, ajustes: payload.ajustes, status: 'mock' };
        }
        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
