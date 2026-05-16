const express = require('express');
const { db, nowIso } = require('../db');

const router = express.Router();

const STATUS_VALIDOS = ['online', 'offline', 'alerta', 'desconhecido'];

router.get('/', (_req, res) => {
    const linhas = db.prepare('SELECT * FROM integracoes ORDER BY rotulo ASC').all();
    res.json({ total: linhas.length, integracoes: linhas });
});

router.patch('/:chave', (req, res) => {
    const { status, detalhe } = req.body || {};
    if (status && !STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ erro: 'Status inválido', validos: STATUS_VALIDOS });
    }
    const integ = db.prepare('SELECT * FROM integracoes WHERE chave = ?').get(req.params.chave);
    if (!integ) return res.status(404).json({ erro: 'Integração não cadastrada' });

    db.prepare(`
        UPDATE integracoes
        SET status = COALESCE(?, status),
            detalhe = COALESCE(?, detalhe),
            ultima_checagem = ?
        WHERE chave = ?
    `).run(status, detalhe, nowIso(), req.params.chave);

    res.json(db.prepare('SELECT * FROM integracoes WHERE chave = ?').get(req.params.chave));
});

module.exports = router;
