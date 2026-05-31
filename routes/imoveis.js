const express = require('express');
const { db, registrarLog } = require('../db');
const { enriquecerImovel } = require('../lib/enriquecer-imoveis');

const router = express.Router();

function decode(linha) {
    if (!linha) return linha;
    return {
        ...linha,
        fotos:           linha.fotos           ? JSON.parse(linha.fotos)           : [],
        forma_pagamento: linha.forma_pagamento  ? JSON.parse(linha.forma_pagamento) : [],
        caracteristicas: linha.caracteristicas  ? JSON.parse(linha.caracteristicas) : [],
    };
}

router.get('/', (req, res) => {
    const { tipo, bairro, q, preco_min, preco_max, ordenar = 'preco_asc' } = req.query;
    const where = [];
    const params = [];
    if (tipo)      { where.push('tipo = ?');         params.push(tipo); }
    if (bairro)    { where.push('bairro = ?');       params.push(bairro); }
    if (preco_min) { where.push('preco >= ?');       params.push(Number(preco_min)); }
    if (preco_max) { where.push('preco <= ?');       params.push(Number(preco_max)); }
    if (q) {
        where.push('(titulo LIKE ? OR descricao LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like);
    }
    const ordens = {
        preco_asc:  'preco ASC NULLS LAST',
        preco_desc: 'preco DESC NULLS LAST',
        recente:    'importado_em DESC'
    };
    const orderBy = ordens[ordenar] || ordens.preco_asc;
    const sql = `SELECT * FROM imoveis ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
    const linhas = db.prepare(sql).all(...params).map(decode);
    res.json({ total: linhas.length, imoveis: linhas });
});

router.get('/stats', (_req, res) => {
    const total       = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
    const porTipo     = db.prepare("SELECT tipo, COUNT(*) AS n FROM imoveis GROUP BY tipo ORDER BY n DESC").all();
    const porBairro   = db.prepare("SELECT bairro, COUNT(*) AS n FROM imoveis WHERE bairro IS NOT NULL GROUP BY bairro").all();
    const stats       = db.prepare("SELECT MIN(preco) AS minimo, MAX(preco) AS maximo, AVG(preco) AS media FROM imoveis WHERE preco > 0").get();
    res.json({ total, por_tipo: porTipo, por_bairro: porBairro, preco: stats });
});

// ── Enriquecimento de dados (preenche campos vazios a partir da descrição) ─────

// POST /api/imoveis/:id/enriquecer — completa 1 imóvel
router.post('/:id/enriquecer', async (req, res, next) => {
    try {
        const imovel = decode(db.prepare('SELECT * FROM imoveis WHERE id = ?').get(req.params.id));
        if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
        const r = await enriquecerImovel(imovel);
        if (r.ok && Object.keys(r.mudou || {}).length) {
            registrarLog({ agente: 'sistema', nivel: 'sucesso', mensagem: `Dados completados: ${imovel.titulo}`, contexto: { id: imovel.id, mudou: r.mudou } });
        }
        res.json(r);
    } catch (err) { next(err); }
});

// Estado do enriquecimento em massa (memória)
let _enriq = { rodando: false, total: 0, feitos: 0, preenchidos: 0, atual: '' };

// POST /api/imoveis/enriquecer-todos — completa TODOS em background
router.post('/enriquecer-todos', (req, res) => {
    if (_enriq.rodando) return res.status(409).json({ erro: 'Já está rodando', estado: _enriq });
    const imoveis = db.prepare('SELECT * FROM imoveis').all().map(decode);
    _enriq = { rodando: true, total: imoveis.length, feitos: 0, preenchidos: 0, atual: '' };
    res.json({ iniciado: true, total: imoveis.length });

    (async () => {
        for (const imovel of imoveis) {
            _enriq.atual = imovel.titulo;
            try {
                const r = await enriquecerImovel(imovel);
                if (r.ok && Object.keys(r.mudou || {}).length) _enriq.preenchidos++;
            } catch (e) { /* segue */ }
            _enriq.feitos++;
        }
        _enriq.rodando = false;
        _enriq.atual = '';
        registrarLog({ agente: 'sistema', nivel: 'sucesso', mensagem: `Enriquecimento concluído: ${_enriq.preenchidos}/${_enriq.total} imóveis completados` });
    })();
});

// GET /api/imoveis/enriquecer-status — progresso
router.get('/enriquecer-status', (_req, res) => res.json(_enriq));

router.get('/:id', (req, res) => {
    const imovel = db.prepare('SELECT * FROM imoveis WHERE id = ?').get(req.params.id);
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    res.json(decode(imovel));
});

module.exports = router;
