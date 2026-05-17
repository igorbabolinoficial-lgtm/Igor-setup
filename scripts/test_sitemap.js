// Diagnóstico: testa quantas URLs do sitemap respondem com estrutura válida de imóvel.
const SITEMAP = 'http://imobiliariapraiadorosa.com.br/sitemap.xml';

(async () => {
    const xml = await (await fetch(SITEMAP)).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map(m => m[1].trim())
        .filter(u => /\/property\/.+~\d+/.test(u));

    console.log(`Sitemap: ${urls.length} URLs de property`);

    let ok = 0, vazio = 0, err = 0, semDataId = 0;
    const detalhes = [];

    for (const u of urls) {
        try {
            const r = await fetch(u, { headers: { 'User-Agent': 'IgorTest' }, redirect: 'follow' });
            const html = await r.text();
            if (r.status >= 400) { err++; detalhes.push({u, status: r.status}); continue; }
            if (!html || html.length < 1000) { vazio++; continue; }
            if (!html.includes('data-id')) { semDataId++; detalhes.push({u, motivo: 'sem data-id'}); continue; }
            ok++;
        } catch (e) {
            err++;
            detalhes.push({u, err: e.message});
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n=== RESUMO ===`);
    console.log(`OK (com data-id): ${ok}`);
    console.log(`Sem data-id:      ${semDataId}`);
    console.log(`Vazio/curto:      ${vazio}`);
    console.log(`Erro HTTP:        ${err}`);
    console.log(`Total testado:    ${urls.length}`);
    if (detalhes.length) {
        console.log('\nProblemáticos (primeiros 10):');
        detalhes.slice(0, 10).forEach(d => console.log(' -', d));
    }
})();
