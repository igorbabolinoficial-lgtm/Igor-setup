const express = require('express');
const { db } = require('../db');

const router = express.Router();

function decode(linha) {
    if (!linha) return linha;
    return {
        ...linha,
        fotos: linha.fotos ? JSON.parse(linha.fotos) : []
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

router.get('/:id', (req, res) => {
    const imovel = db.prepare('SELECT * FROM imoveis WHERE id = ?').get(req.params.id);
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    res.json(decode(imovel));
});

module.exports = router;
