// lib/criativos/index.js — Motor de geração de artes de imóveis (CommonJS)
// Gera criativos em 4 formatos (story/feed/quadrado/horizontal) a partir de um imóvel do banco.
// Renderiza um template HTML via puppeteer e devolve PNG.

const fs   = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'template.html');
const FORMATOS = {
    story:      { w: 1080, h: 1920 },
    feed:       { w: 1080, h: 1350 },
    quadrado:   { w: 1080, h: 1080 },
    horizontal: { w: 1200, h: 628  },
};

// Diretório onde ficam as fotos HD (volume persistente em prod)
function hdDir(imovelId) {
    const base = process.env.ASSETS_DIR || path.join(__dirname, '..', '..', 'assets', 'imoveis');
    return path.join(base, `${imovelId}-hd`);
}

// ── Download de fotos HD do site (remove sufixo -800X500 → pega original) ──────
async function baixarFotosHD(imovel, puppeteer) {
    const destino = hdDir(imovel.id);
    // Já baixado?
    if (fs.existsSync(destino)) {
        const existentes = fs.readdirSync(destino).filter(f => /\.\w+$/.test(f));
        if (existentes.length) return destino;
    }
    if (!imovel.url_origem) return null;

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        const url = imovel.url_origem.replace(/^http:/, 'https:');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2500));

        // Extrai URLs da galeria do imóvel (containers owl-carousel)
        let urls = await page.evaluate(() => {
            const set = new Set();
            const push = u => { if (u && /uploads\/media\//.test(u) && /\.(jpe?g|png|jfif)/i.test(u)) set.add(u); };
            ['#sl-slider', '#sl-slider-thumb'].forEach(sel => {
                document.querySelectorAll(`${sel} img`).forEach(el => { push(el.src); push(el.getAttribute('data-src')); });
            });
            return [...set];
        });

        // As imagens já vêm só do #sl-slider (galeria do imóvel) — normaliza p/ original (sem -NNNxNNN).
        // Descarta logos/ícones por nome.
        const originais = [...new Set(
            urls.filter(u => !/LOGO|logo_|whats|al81s|icon/i.test(u))
                .map(u => u.replace(/-\d+X\d+(\.\w+)$/i, '$1'))
        )];
        if (!originais.length) return null;

        fs.mkdirSync(destino, { recursive: true });
        let i = 0;
        for (const u of originais) {
            try {
                const resp = await fetch(u, {
                    headers: { 'Referer': url, 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
                });
                if (!resp.ok) continue;
                const buf = Buffer.from(await resp.arrayBuffer());
                const ext = (u.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
                fs.writeFileSync(path.join(destino, `${i}.${ext}`), buf);
                i++;
            } catch { /* pula foto que falhar */ }
        }
        return i ? destino : null;
    } finally {
        await browser.close();
    }
}

// Lista as fotos HD disponíveis (paths absolutos, ordenadas)
function listarFotosHD(imovelId) {
    const dir = hdDir(imovelId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.\w+$/.test(f))
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(f => path.join(dir, f));
}

// Converte arquivo de imagem em data URI (pro template não depender de servidor de arquivos)
function toDataUri(fp) {
    const ext = path.extname(fp).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(fp).toString('base64')}`;
}

// ── Deriva o conteúdo do criativo a partir do registro do imóvel ───────────────
function montarConteudo(imovel) {
    const cidade = imovel.bairro || 'Litoral SC';
    const negocio = (imovel.negocio || 'venda').toLowerCase().includes('alug') ? 'Aluga-se' : 'Casa à venda';
    const tipoTxt = imovel.tipo ? imovel.tipo.charAt(0).toUpperCase() + imovel.tipo.slice(1) : 'Imóvel';

    const checks = [];
    const linha1 = [];
    if (imovel.area_m2) linha1.push(`${imovel.area_m2}m²`);
    if (imovel.quartos) linha1.push(`${imovel.quartos} ${imovel.quartos > 1 ? 'dormitórios' : 'dormitório'}`);
    if (linha1.length) checks.push(linha1.join(' · '));
    if (Array.isArray(imovel.caracteristicas)) {
        for (const c of imovel.caracteristicas.slice(0, 2)) checks.push(c);
    }
    if (checks.length < 3 && imovel.bairro) checks.push(`Bairro ${imovel.bairro}`);

    const badges = [];
    const fp = Array.isArray(imovel.forma_pagamento) ? imovel.forma_pagamento.join(' ').toLowerCase() : '';
    if (fp.includes('financ')) badges.push('Financia');
    if (imovel.aceita_fgts) badges.push('Aceita FGTS');
    if (badges.length < 2) badges.push('Pronta pra morar');

    return {
        selo: `${negocio} · ${cidade}`,
        titulo: imovel.titulo || `${tipoTxt} em ${cidade}`,
        tituloGold: false,
        subtitulo: '',
        checks: checks.slice(0, 3),
        preco: imovel.preco,
        badges: badges.slice(0, 2),
    };
}

// ── Gera UMA arte (formato) → retorna PNG buffer ───────────────────────────────
// opts: { formato, fotosIdx?:[0,1,2], conteudoOverride?:{} }
async function gerarArte(imovel, opts = {}) {
    const puppeteer = require('puppeteer');
    const formato = FORMATOS[opts.formato] ? opts.formato : 'story';
    const dim = FORMATOS[formato];

    // Garante fotos HD (baixa se preciso) — best-effort
    let fotosPaths = listarFotosHD(imovel.id);
    if (!fotosPaths.length) {
        try { await baixarFotosHD(imovel, puppeteer); } catch { /* segue sem HD */ }
        fotosPaths = listarFotosHD(imovel.id);
    }
    // Fallback: fotos locais 800x500 do próprio registro
    if (!fotosPaths.length && Array.isArray(imovel.fotos) && imovel.fotos.length) {
        const base = process.env.ASSETS_DIR || path.join(__dirname, '..', '..', 'assets', 'imoveis');
        fotosPaths = imovel.fotos
            .map(rel => path.join(base, '..', rel.replace(/^\/?assets\/imoveis\//, '')))
            .filter(p => fs.existsSync(p));
    }

    // Seleção de fotos (capa + 2 mosaico)
    const idx = opts.fotosIdx || [0, 1, 2];
    const fotos = idx.map(i => fotosPaths[i] || fotosPaths[0]).filter(Boolean).map(toDataUri);

    const dados = Object.assign(montarConteudo(imovel), opts.conteudoOverride || {}, { formato, fotos });

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: dim.w, height: dim.h, deviceScaleFactor: 1 });
        await page.goto('file://' + TEMPLATE.replace(/\\/g, '/'), { waitUntil: 'load' });
        await page.evaluate(d => { window.__DADOS__ = d; render(d); }, dados);
        await page.evaluate(() =>
            Promise.all(Array.from(document.images).map(img =>
                img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })))
        );
        const el = await page.$('#arte');
        const png = await el.screenshot({ type: 'png' });
        return png;
    } finally {
        await browser.close();
    }
}

module.exports = { gerarArte, baixarFotosHD, listarFotosHD, montarConteudo, FORMATOS };
