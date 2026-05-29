// routes/criativos.js — Geração de artes de imóveis (4 formatos) sob demanda.
'use strict';

const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { gerarArte, baixarFotosHD, listarFotosHD, FORMATOS } = require('../lib/criativos');

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

module.exports = router;
