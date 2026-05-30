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

// ── Extrai as URLs da galeria do imóvel no site original (só as fotos dele) ────
async function extrairUrlsGaleria(page, urlOrigem) {
    const url = urlOrigem.replace(/^http:/, 'https:');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));

    // SÓ os containers da galeria do imóvel (owl-carousel #sl-slider / #sl-slider-thumb).
    // Imóveis "relacionados" ficam em outros containers — não entram aqui.
    const urls = await page.evaluate(() => {
        const set = new Set();
        const push = u => { if (u && /uploads\/media\//.test(u) && /\.(jpe?g|png|jfif)/i.test(u)) set.add(u); };
        ['#sl-slider', '#sl-slider-thumb'].forEach(sel => {
            document.querySelectorAll(`${sel} img`).forEach(el => { push(el.src); push(el.getAttribute('data-src')); });
        });
        return [...set];
    });

    // Normaliza p/ original (remove sufixo -NNNxNNN) e descarta logos/ícones.
    return [...new Set(
        urls.filter(u => !/LOGO|logo_|whats|al81s|icon/i.test(u))
            .map(u => u.replace(/-\d+X\d+(\.\w+)$/i, '$1'))
    )];
}

// Baixa uma lista de URLs pra um destino. Se limpar=true, esvazia o destino antes.
async function baixarParaDir(urls, destino, referer, { limpar = false } = {}) {
    if (limpar && fs.existsSync(destino)) {
        for (const f of fs.readdirSync(destino)) {
            try { fs.unlinkSync(path.join(destino, f)); } catch {}
        }
    }
    fs.mkdirSync(destino, { recursive: true });
    const salvos = [];
    let i = 0;
    for (const u of urls) {
        try {
            const resp = await fetch(u, {
                headers: { 'Referer': referer, 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
            });
            if (!resp.ok) continue;
            const buf = Buffer.from(await resp.arrayBuffer());
            const ext = (u.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
            const nome = `${i}.${ext}`;
            fs.writeFileSync(path.join(destino, nome), buf);
            salvos.push(nome);
            i++;
        } catch { /* pula foto que falhar */ }
    }
    return salvos;
}

// ── Download de fotos HD do site (cache em {id}-hd, pro motor de criativos) ─────
async function baixarFotosHD(imovel, puppeteer) {
    const destino = hdDir(imovel.id);
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
        const urls = await extrairUrlsGaleria(page, imovel.url_origem);
        if (!urls.length) return null;
        const salvos = await baixarParaDir(urls, destino, imovel.url_origem.replace(/^http:/, 'https:'));
        return salvos.length ? destino : null;
    } finally {
        await browser.close();
    }
}

// ── Re-sincroniza as fotos do imóvel a partir do site original ─────────────────
// Baixa SÓ a galeria da página dele, substitui as antigas (que estavam embaralhadas)
// em {ASSETS_DIR}/{id}/ e devolve os paths relativos pro campo `fotos` do banco.
async function ressincronizarImovel(imovel) {
    if (!imovel.url_origem) return { ok: false, motivo: 'sem url_origem' };
    const puppeteer = require('puppeteer');
    const base = process.env.ASSETS_DIR || path.join(__dirname, '..', '..', 'assets', 'imoveis');
    const destino = path.join(base, imovel.id);

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        const urls = await extrairUrlsGaleria(page, imovel.url_origem);
        if (!urls.length) return { ok: false, motivo: 'galeria vazia no site' };

        const salvos = await baixarParaDir(urls, destino, imovel.url_origem.replace(/^http:/, 'https:'), { limpar: true });
        if (!salvos.length) return { ok: false, motivo: 'nenhuma foto baixada' };

        // Invalida cache HD do motor pra ele re-baixar alinhado na próxima arte
        try {
            const hd = hdDir(imovel.id);
            if (fs.existsSync(hd)) fs.rmSync(hd, { recursive: true, force: true });
        } catch {}

        const fotosRel = salvos.map(n => `/assets/imoveis/${imovel.id}/${n}`);
        return { ok: true, total: fotosRel.length, fotos: fotosRel };
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

module.exports = { gerarArte, baixarFotosHD, listarFotosHD, montarConteudo, ressincronizarImovel, FORMATOS };
