#!/usr/bin/env node
/**
 * Extrator de imóveis — imobiliariapraiadorosa.com.br
 *
 * Uso: node extrator.js [--max=N] [--mock]
 *   --max=N   limita N imóveis (padrão: tudo)
 *   --mock    pula scraping real e gera dados mock
 *
 * Saída: imoveis.json no diretório atual
 */

const fs = require('fs');
const path = require('path');

const SITEMAP = 'https://www.imobiliariapraiadorosa.com.br/sitemap.xml';
const SAIDA = path.join(__dirname, 'imoveis.json');

function flag(nome) {
    const a = process.argv.find(a => a.startsWith(`--${nome}`));
    if (!a) return null;
    if (a.includes('=')) return a.split('=')[1];
    return true;
}

async function buscar(url, opts = {}) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Igor Neural Extrator)' },
        ...opts
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
    return r.text();
}

function extrairUrlsDoSitemap(xml) {
    const urls = [];
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
    return urls;
}

function parseImovel(html, url) {
    const titulo = (html.match(/<title>([^<]+)<\/title>/) || [, ''])[1].trim();
    const og  = (rgx) => (html.match(rgx) || [, ''])[1];
    const descricao = og(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
                   || og(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
    const precoMatch = html.match(/R\$\s*([\d\.\,]+)/);
    const preco = precoMatch ? Number(precoMatch[1].replace(/\./g, '').replace(',', '.')) : null;
    return { url, titulo, descricao, preco };
}

function gerarMock(n = 152) {
    const tiposImovel = ['Apartamento', 'Casa', 'Terreno', 'Cobertura', 'Loft'];
    const bairros     = ['Praia do Rosa Norte', 'Praia do Rosa Sul', 'Ibiraquera', 'Vigia', 'Barra'];
    const out = [];
    for (let i = 1; i <= n; i++) {
        const t = tiposImovel[i % tiposImovel.length];
        const b = bairros[i % bairros.length];
        out.push({
            url: `https://www.imobiliariapraiadorosa.com.br/imovel/${i}`,
            titulo: `${t} ${i} dormitórios — ${b}`,
            descricao: `Imóvel ${t.toLowerCase()} localizado em ${b}, com vista para o mar.`,
            preco: 380000 + (i * 17000) % 2200000
        });
    }
    return out;
}

async function main() {
    const usarMock = flag('mock');
    const limite = Number(flag('max')) || Infinity;

    if (usarMock) {
        const data = gerarMock(Math.min(152, limite));
        fs.writeFileSync(SAIDA, JSON.stringify({ origem: 'mock', total: data.length, imoveis: data }, null, 2));
        console.log(`[extrator] Mock: ${data.length} imóveis salvos em ${SAIDA}`);
        return;
    }

    console.log(`[extrator] Buscando sitemap: ${SITEMAP}`);
    let urls = [];
    try {
        const xml = await buscar(SITEMAP);
        urls = extrairUrlsDoSitemap(xml).filter(u => u.includes('/imovel/') || u.includes('/imoveis/'));
    } catch (err) {
        console.error(`[extrator] Falha no sitemap: ${err.message}. Caindo pra mock.`);
        const data = gerarMock();
        fs.writeFileSync(SAIDA, JSON.stringify({ origem: 'mock_fallback', erro: err.message, total: data.length, imoveis: data }, null, 2));
        return;
    }

    if (urls.length === 0) {
        console.log('[extrator] Sitemap não tinha URLs de imóvel. Gerando mock.');
        const data = gerarMock();
        fs.writeFileSync(SAIDA, JSON.stringify({ origem: 'mock_sem_urls', total: data.length, imoveis: data }, null, 2));
        return;
    }

    urls = urls.slice(0, limite);
    console.log(`[extrator] ${urls.length} URLs detectadas. Extraindo...`);
    const imoveis = [];
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            const html = await buscar(url);
            imoveis.push(parseImovel(html, url));
            if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${urls.length}...`);
            await new Promise(r => setTimeout(r, 250));
        } catch (err) {
            console.warn(`  falhou ${url}: ${err.message}`);
        }
    }

    fs.writeFileSync(SAIDA, JSON.stringify({ origem: 'scrape', total: imoveis.length, imoveis }, null, 2));
    console.log(`[extrator] ${imoveis.length} imóveis salvos em ${SAIDA}`);
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}
