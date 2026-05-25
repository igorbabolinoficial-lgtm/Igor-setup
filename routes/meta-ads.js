// routes/meta-ads.js — CRUD de campanhas Meta Lead Ads via Marketing API
// Usa meta-ads.js (ESM) carregado via dynamic import()

const express = require('express');
const path    = require('path');
const router  = express.Router();

// Carrega o módulo ESM uma vez e reutiliza
let _mod = null;
async function mod() {
    if (!_mod) {
        _mod = await import(
            /* webpackIgnore: true */
            `file://${path.resolve(__dirname, '../lib/meta-ads.js').replace(/\\/g, '/')}`
        );
    }
    return _mod;
}

// GET /api/meta-ads/status — verifica env vars e responde se a integração está pronta
router.get('/status', async (_req, res) => {
    try {
        const { metaAdsReady } = await mod();
        const pronto = metaAdsReady();
        res.json({
            ok: pronto,
            configurado: pronto,
            variaveis: {
                META_SYSTEM_USER_TOKEN: !!process.env.META_SYSTEM_USER_TOKEN,
                META_AD_ACCOUNT_ID:     !!process.env.META_AD_ACCOUNT_ID,
                META_PAGE_ID:           !!process.env.META_PAGE_ID,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// GET /api/meta-ads/campanhas — lista campanhas da conta
router.get('/campanhas', async (_req, res, next) => {
    try {
        const { listarCampanhas } = await mod();
        const r = await listarCampanhas();
        res.json(r);
    } catch (err) { next(err); }
});

// GET /api/meta-ads/campanha/:id/metricas — últimos 7 dias
router.get('/campanha/:id/metricas', async (req, res, next) => {
    try {
        const { metricas } = await mod();
        const r = await metricas(req.params.id);
        res.json(r);
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha/:id/pausar
router.post('/campanha/:id/pausar', async (req, res, next) => {
    try {
        const { pausarCampanha } = await mod();
        const r = await pausarCampanha(req.params.id);
        res.json(r);
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha/:id/ativar
router.post('/campanha/:id/ativar', async (req, res, next) => {
    try {
        const { ativarCampanha } = await mod();
        const r = await ativarCampanha(req.params.id);
        res.json(r);
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha — cria lead ad completo
// Body: {
//   nomeCampanha: string,
//   imagemPath: string,       // caminho absoluto no servidor OU URL pública
//   titulo: string,           // headline
//   corpo: string,            // texto principal
//   orcamentoDiarioBRL?: number,   (default 30)
//   segmentacao?: { cidades, raioKm, idadeMin, idadeMax, genero }
//   status?: 'PAUSED' | 'ACTIVE'  (default PAUSED)
// }
router.post('/campanha', async (req, res, next) => {
    try {
        const { criarLeadAdCompleto } = await mod();
        const {
            nomeCampanha,
            imagemPath,
            titulo,
            corpo,
            orcamentoDiarioBRL = 30,
            segmentacao = {},
            status = 'PAUSED',
        } = req.body || {};

        if (!nomeCampanha || !imagemPath || !titulo || !corpo) {
            return res.status(400).json({
                erro: 'Campos obrigatórios: nomeCampanha, imagemPath, titulo, corpo',
            });
        }

        const ids = await criarLeadAdCompleto({
            nomeCampanha,
            imagemPath,
            titulo,
            corpo,
            orcamentoDiarioBRL,
            segmentacao,
            status,
        });

        res.status(201).json({ ok: true, ...ids });
    } catch (err) { next(err); }
});

module.exports = router;
