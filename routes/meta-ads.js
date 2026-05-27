// routes/meta-ads.js — Rotas da Marketing API do Meta (Click to WhatsApp)

const express = require('express');
const path    = require('path');
const router  = express.Router();

let _mod = null;
async function mod() {
    if (!_mod) {
        _mod = await import(
            /* webpackIgnore: true */
            `file://${path.resolve(__dirname, '../lib/meta-ads.mjs').replace(/\\/g, '/')}`
        );
    }
    return _mod;
}

// GET /api/meta-ads/status
router.get('/status', async (_req, res) => {
    try {
        const { metaAdsReady } = await mod();
        res.json({
            ok: metaAdsReady(),
            variaveis: {
                META_SYSTEM_USER_TOKEN: !!process.env.META_SYSTEM_USER_TOKEN,
                META_AD_ACCOUNT_ID:     !!process.env.META_AD_ACCOUNT_ID,
                META_PAGE_ID:           !!process.env.META_PAGE_ID,
                META_WHATSAPP_NUMBER:   !!process.env.META_WHATSAPP_NUMBER,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// GET /api/meta-ads/campanhas
router.get('/campanhas', async (_req, res, next) => {
    try {
        const { listarCampanhas } = await mod();
        res.json(await listarCampanhas());
    } catch (err) { next(err); }
});

// GET /api/meta-ads/campanha/:id/adsets
router.get('/campanha/:id/adsets', async (req, res, next) => {
    try {
        const { listarAdSets } = await mod();
        res.json(await listarAdSets(req.params.id));
    } catch (err) { next(err); }
});

// GET /api/meta-ads/campanha/:id/anuncios
router.get('/campanha/:id/anuncios', async (req, res, next) => {
    try {
        const { listarAnuncios } = await mod();
        res.json(await listarAnuncios(req.params.id));
    } catch (err) { next(err); }
});

// GET /api/meta-ads/campanha/:id/comparativo — performance lado a lado de todos os anúncios
router.get('/campanha/:id/comparativo', async (req, res, next) => {
    try {
        const { comparativoAnuncios } = await mod();
        const periodo = req.query.periodo || 'last_7d';
        res.json(await comparativoAnuncios(req.params.id, periodo));
    } catch (err) { next(err); }
});

// GET /api/meta-ads/campanha/:id/metricas
router.get('/campanha/:id/metricas', async (req, res, next) => {
    try {
        const { metricas } = await mod();
        res.json(await metricas(req.params.id, req.query.periodo || 'last_7d'));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha/:id/pausar
router.post('/campanha/:id/pausar', async (req, res, next) => {
    try {
        const { pausarCampanha } = await mod();
        res.json(await pausarCampanha(req.params.id));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha/:id/ativar
router.post('/campanha/:id/ativar', async (req, res, next) => {
    try {
        const { ativarCampanha } = await mod();
        res.json(await ativarCampanha(req.params.id));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/campanha — cria campanha completa (múltiplos ad sets + anúncios)
// Body: { nomeCampanha, adSets: [{ nome, perfil, orcamentoDiarioBRL, segmentacao, anuncios: [{titulo,corpo,imagemPath,mensagemInicial}] }], status }
// perfil: 'local' | 'investidor' | 'veraneiro' | null (usa segmentacao custom)
router.post('/campanha', async (req, res, next) => {
    try {
        const { criarCampanhaCompleta } = await mod();
        const { nomeCampanha, adSets, status = 'PAUSED' } = req.body || {};
        if (!nomeCampanha || !adSets?.length) {
            return res.status(400).json({ erro: 'nomeCampanha e adSets[] obrigatórios' });
        }
        res.status(201).json(await criarCampanhaCompleta({ nomeCampanha, adSets, status }));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/adset/:id/duplicar — clona ad set com público diferente
// Body: { novoNome?, novaSegmentacao?: { cidades, raioKm, idadeMin, idadeMax }, status? }
router.post('/adset/:id/duplicar', async (req, res, next) => {
    try {
        const { duplicarAdSet } = await mod();
        const { novoNome, novaSegmentacao, status } = req.body || {};
        const novoId = await duplicarAdSet({ adSetId: req.params.id, novoNome, novaSegmentacao, status });
        res.json({ ok: true, novoAdSetId: novoId });
    } catch (err) { next(err); }
});

// POST /api/meta-ads/adset/:id/pausar
router.post('/adset/:id/pausar', async (req, res, next) => {
    try {
        const { pausarAdSet } = await mod();
        res.json(await pausarAdSet(req.params.id));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/adset/:id/ativar
router.post('/adset/:id/ativar', async (req, res, next) => {
    try {
        const { ativarAdSet } = await mod();
        res.json(await ativarAdSet(req.params.id));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/anuncio/:id/duplicar — clona anúncio (mesmo ou outro ad set)
// Body: { novoAdSetId?, novoNome?, status? }
router.post('/anuncio/:id/duplicar', async (req, res, next) => {
    try {
        const { duplicarAnuncio } = await mod();
        const { novoAdSetId, novoNome, status } = req.body || {};
        const novoId = await duplicarAnuncio({ anuncioId: req.params.id, novoAdSetId, novoNome, status });
        res.json({ ok: true, novoAnuncioId: novoId });
    } catch (err) { next(err); }
});

// POST /api/meta-ads/anuncio/:id/pausar
router.post('/anuncio/:id/pausar', async (req, res, next) => {
    try {
        const { pausarAnuncio } = await mod();
        res.json(await pausarAnuncio(req.params.id));
    } catch (err) { next(err); }
});

// POST /api/meta-ads/anuncio/:id/ativar
router.post('/anuncio/:id/ativar', async (req, res, next) => {
    try {
        const { ativarAnuncio } = await mod();
        res.json(await ativarAnuncio(req.params.id));
    } catch (err) { next(err); }
});

module.exports = router;
