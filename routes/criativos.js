// routes/criativos.js — Geração de artes de imóveis (4 formatos) sob demanda.
'use strict';

const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { gerarArte, baixarFotosHD, listarFotosHD, ressincronizarImovel, FORMATOS } = require('../lib/criativos');
const { registrarLog } = require('../db');

function decodeImovel(linha) {
    if (!linha) return null;
    return {
        ...linha,
        fotos:           linha.fotos           ? JSON.parse(linha.fotos)           : [],
        forma_pagamento: linha.forma_pagamento ? JSON.parse(linha.forma_pagamento) : [],
        caracteristicas: linha.caracteristicas ? JSON.parse(linha.caracteristicas) : [],
    };
}

function pegarImovel(id) {
    return decodeImovel(db.prepare('SELECT * FROM imoveis WHERE id = ?').get(id));
}

// GET /api/criativos/:id/fotos — garante fotos HD e devolve as URLs (pra UI escolher capa/mosaico)
router.get('/:id/fotos', async (req, res, next) => {
    try {
        const imovel = pegarImovel(req.params.id);
        if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

        let fotos = listarFotosHD(imovel.id);
        if (!fotos.length) {
            const puppeteer = require('puppeteer');
            try { await baixarFotosHD(imovel, puppeteer); } catch { /* segue */ }
            fotos = listarFotosHD(imovel.id);
        }
        // devolve como URLs servidas pelo static /assets/imoveis/:id-hd/
        const urls = fotos.map((_, i) => {
            const nome = require('path').basename(fotos[i]);
            return { idx: i, url: `/assets/imoveis/${imovel.id}-hd/${nome}` };
        });
        res.json({ ok: true, total: urls.length, fotos: urls });
    } catch (err) { next(err); }
});

// GET /api/criativos/:id/arte.png?formato=story&capa=0&m1=1&m2=2
// Gera e devolve UM PNG no formato pedido.
router.get('/:id/arte.png', async (req, res, next) => {
    try {
        const imovel = pegarImovel(req.params.id);
        if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

        const formato = FORMATOS[req.query.formato] ? req.query.formato : 'story';
        const capa = parseInt(req.query.capa ?? '0', 10) || 0;
        const m1   = parseInt(req.query.m1 ?? String(capa + 1), 10);
        const m2   = parseInt(req.query.m2 ?? String(capa + 2), 10);

        const png = await gerarArte(imovel, { formato, fotosIdx: [capa, m1, m2] });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `inline; filename="${imovel.slug || imovel.id}-${formato}.png"`);
        res.send(png);
    } catch (err) { next(err); }
});

// ── Re-sincronização de fotos (corrige embaralhamento da exportação antiga) ────

// POST /api/criativos/:id/resync — re-baixa as fotos do site original e atualiza o banco
router.post('/:id/resync', async (req, res, next) => {
    try {
        const imovel = pegarImovel(req.params.id);
        if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

        const r = await ressincronizarImovel(imovel);
        if (r.ok) {
            db.prepare('UPDATE imoveis SET fotos = ? WHERE id = ?').run(JSON.stringify(r.fotos), imovel.id);
            registrarLog({ agente: 'sistema', nivel: 'sucesso', mensagem: `Fotos re-sincronizadas: ${imovel.titulo} (${r.total})`, contexto: { id: imovel.id } });
        }
        res.json(r);
    } catch (err) { next(err); }
});

// Estado do resync em massa (em memória)
let _resync = { rodando: false, total: 0, feitos: 0, ok: 0, falhas: 0, atual: '', erros: [] };

// POST /api/criativos/resync-todos — corrige TODOS os imóveis em background
router.post('/resync-todos', (req, res) => {
    if (_resync.rodando) return res.status(409).json({ erro: 'Já está rodando', estado: _resync });

    const imoveis = db.prepare('SELECT * FROM imoveis WHERE url_origem IS NOT NULL').all().map(decodeImovel);
    _resync = { rodando: true, total: imoveis.length, feitos: 0, ok: 0, falhas: 0, atual: '', erros: [] };
    res.json({ iniciado: true, total: imoveis.length });

    // processa serial em background (não bloqueia a resposta)
    (async () => {
        for (const imovel of imoveis) {
            _resync.atual = imovel.titulo;
            try {
                const r = await ressincronizarImovel(imovel);
                if (r.ok) {
                    db.prepare('UPDATE imoveis SET fotos = ? WHERE id = ?').run(JSON.stringify(r.fotos), imovel.id);
                    _resync.ok++;
                } else {
                    _resync.falhas++;
                    _resync.erros.push(`${imovel.titulo}: ${r.motivo}`);
                }
            } catch (e) {
                _resync.falhas++;
                _resync.erros.push(`${imovel.titulo}: ${e.message}`);
            }
            _resync.feitos++;
        }
        _resync.rodando = false;
        _resync.atual = '';
        registrarLog({ agente: 'sistema', nivel: 'sucesso', mensagem: `Resync de fotos concluído: ${_resync.ok} ok, ${_resync.falhas} falhas` });
    })();
});

// GET /api/criativos/resync-status — progresso do resync em massa
router.get('/resync-status', (_req, res) => res.json(_resync));

module.exports = router;
