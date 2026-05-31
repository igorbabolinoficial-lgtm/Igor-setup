// routes/qualidade.js — Painel de qualidade do bot (auto-crítica + regras aprendidas).
'use strict';

const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { analisarConversa, analisarEsfriadas, aprovarRegra, rejeitarRegra, TIPOS_ERRO } = require('../lib/analista-conversas');

// GET /api/qualidade/resumo — visão geral
router.get('/resumo', (_req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM analises_conversa').get().n;
    const scoreMedio = db.prepare('SELECT AVG(score) AS m FROM analises_conversa').get().m;
    const porTipo = db.prepare(`SELECT tipo_erro, ocorrencias, status FROM regras_propostas ORDER BY ocorrencias DESC`).all();
    res.json({ total_analises: total, score_medio: scoreMedio ? Math.round(scoreMedio * 10) / 10 : null, padroes: porTipo });
});

// GET /api/qualidade/analises?limit=20 — últimas análises
router.get('/analises', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const rows = db.prepare('SELECT * FROM analises_conversa ORDER BY id DESC LIMIT ?').all(limit);
    res.json({ analises: rows.map(r => ({ ...r, erros: (() => { try { return JSON.parse(r.erros || '[]'); } catch { return []; } })() })) });
});

// GET /api/qualidade/regras — regras propostas (pra aprovar/rejeitar)
router.get('/regras', (req, res) => {
    const status = req.query.status || 'proposta';
    const rows = db.prepare('SELECT * FROM regras_propostas WHERE status = ? ORDER BY ocorrencias DESC').all(status);
    res.json({
        regras: rows.map(r => ({
            ...r,
            descricao_tipo: TIPOS_ERRO[r.tipo_erro] || r.tipo_erro,
            exemplos: (() => { try { return JSON.parse(r.exemplos || '[]'); } catch { return []; } })(),
        })),
    });
});

router.post('/regras/:id/aprovar',  (req, res) => res.json(aprovarRegra(parseInt(req.params.id, 10))));
router.post('/regras/:id/rejeitar', (req, res) => res.json(rejeitarRegra(parseInt(req.params.id, 10))));

// POST /api/qualidade/analisar/:phone — analisa uma conversa sob demanda
router.post('/analisar/:phone', async (req, res, next) => {
    try { res.json(await analisarConversa(req.params.phone)); }
    catch (err) { next(err); }
});

// POST /api/qualidade/analisar-esfriadas — força a varredura agora (mesma que o cron faz)
router.post('/analisar-esfriadas', async (_req, res, next) => {
    try { res.json(await analisarEsfriadas({ limite: 10 })); }
    catch (err) { next(err); }
});

module.exports = router;
