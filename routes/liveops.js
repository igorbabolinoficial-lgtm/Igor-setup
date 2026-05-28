// routes/liveops.js — Agrega dados de todas as fontes pro painel Live Ops
'use strict';

const express = require('express');
const path    = require('path');
const router  = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

let _metaMod = null;
async function metaMod() {
    if (!_metaMod) {
        _metaMod = await import(
            `file://${path.resolve(__dirname, '../lib/meta-ads.mjs').replace(/\\/g, '/')}`
        );
    }
    return _metaMod;
}

function waUrl()   { return process.env.WA_AGENT_URL; }
function waToken() { return process.env.WA_AGENT_TOKEN; }

async function waFetch(p) {
    const url = waUrl(); const token = waToken();
    if (!url || !token) return null;
    try {
        const r = await fetch(`${url}${p}`, {
            headers: { 'x-webhook-token': token, 'Content-Type': 'application/json' },
        });
        return r.ok ? r.json() : null;
    } catch { return null; }
}

// ── GET /api/liveops ──────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
    const { db, nowIso } = require('../db');
    const hoje = nowIso().slice(0, 10); // YYYY-MM-DD

    // ── 1. Pipeline ──
    let pipeline = { novo_lead: 0, em_atendimento: 0, qualificado: 0, convertido: 0, total: 0, hoje: 0 };
    try {
        const rows = db.prepare(`
            SELECT status, COUNT(*) AS n FROM leads GROUP BY status
        `).all();
        for (const r of rows) {
            if (r.status in pipeline) pipeline[r.status] = r.n;
            pipeline.total += r.n;
        }
        pipeline.hoje = db.prepare(
            `SELECT COUNT(*) AS n FROM leads WHERE criado_em >= ?`
        ).get(hoje + 'T00:00:00').n || 0;
    } catch {}

    // ── 2. WhatsApp Bot ──
    let waBot = { total: 0, hoje: 0, takeover: 0, online: false };
    try {
        const [status, leads] = await Promise.all([
            waFetch('/status'),
            waFetch('/admin/leads'),
        ]);
        waBot.online = status?.instance?.state === 'open';
        const lst = leads?.leads || [];
        waBot.total = lst.length;
        waBot.hoje  = lst.filter(l => (l.last_at || '').startsWith(hoje)).length;
        waBot.takeover = lst.filter(l => {
            try {
                const m = JSON.parse(l.meta || '{}');
                return m.human_takeover_until && new Date(m.human_takeover_until) > new Date();
            } catch { return false; }
        }).length;
    } catch {}

    // ── 3. Meta Ads — campanha ativa ──
    let metaAds = { status: 'DESCONHECIDO', campanha: '—', impressoes: 0, cliques: 0, spend: 0, cpl: 0, anuncios_ativos: 0 };
    try {
        const m = await metaMod();
        // pega primeira campanha ativa
        const camps = await m.listarCampanhas();
        const ativa = (camps.data || []).find(c => c.status === 'ACTIVE') || (camps.data || [])[0];
        if (ativa) {
            metaAds.campanha = ativa.name;
            metaAds.status   = ativa.status;
            // métricas de hoje
            const ins = await m.metricas(ativa.id, 'today').catch(() => null);
            if (ins?.data?.length) {
                const d = ins.data[0];
                metaAds.impressoes = parseInt(d.impressions  || 0, 10);
                metaAds.cliques    = parseInt(d.clicks       || 0, 10);
                metaAds.spend      = parseFloat(d.spend      || 0);
            }
            // contar anúncios ativos
            try {
                const ads = await m.listarAnuncios(ativa.id);
                metaAds.anuncios_ativos = (ads.data || []).filter(a => a.status === 'ACTIVE').length;
            } catch {}
        }
    } catch {}

    // ── 4. Catálogo ──
    let catalogo = { total: 0, venda: 0, aluguel: 0, atualizado: null };
    try {
        catalogo.total   = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n || 0;
        catalogo.venda   = db.prepare("SELECT COUNT(*) AS n FROM imoveis WHERE LOWER(tipo) LIKE '%venda%'").get().n || 0;
        catalogo.aluguel = db.prepare("SELECT COUNT(*) AS n FROM imoveis WHERE LOWER(tipo) LIKE '%aluguel%' OR LOWER(tipo) LIKE '%locacao%'").get().n || 0;
        const ult = db.prepare('SELECT importado_em FROM imoveis ORDER BY importado_em DESC LIMIT 1').get();
        catalogo.atualizado = ult?.importado_em?.slice(0, 10) || null;
    } catch {}

    res.json({ ok: true, pipeline, waBot, metaAds, catalogo, geradoEm: nowIso() });
});

module.exports = router;
