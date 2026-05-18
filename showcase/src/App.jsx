import React, { useEffect, useState } from 'react';
import './App.css';

const HERO_BG = '/assets/hero.jpg';

function fmtBRL(v) {
  if (v == null) return 'Sob consulta';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

const LISTINGS = [
  {
    tag: 'Garopaba',
    title: 'Casa Frente Mar',
    price: 'R$ 3.700.000',
    detail: '4 quartos · 5 banheiros · 230m² · 2 vagas',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/fremar_2-1718647562-800X500.jpg',
    link: '/catalogo.html?q=Casa+Frente+Mar',
  },
  {
    tag: 'Garopaba',
    title: 'Casa Exclusiva com Vista Total',
    price: 'R$ 4.800.000',
    detail: '4 quartos · 4 banheiros · 249m² · 2 vagas',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/guga_11-1758540093-800X500.jfif',
    link: '/catalogo.html?q=Casa+Exclusiva+com+Vista+Total',
  },
  {
    tag: 'Praia do Rosa',
    title: 'Pousada no Centrinho do Rosa',
    price: 'R$ 4.500.000',
    detail: '789m² · estrutura completa · centro do Rosa',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/8db6e59e-18ac-4afa-80a2-b56cddaf4fd1-1678013341-800X500.jpg',
    link: '/catalogo.html?q=Pousa+Incrivel+no+Centrinho',
  },
  {
    tag: 'Praia do Rosa',
    title: 'Terreno Frente Lagoa',
    price: 'R$ 6.999.999',
    detail: '14.670m² · beira de lagoa · investimento',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/frente_lagoa_1-1678975080-800X500.jpg',
    link: '/catalogo.html?q=Terreno+Frente+Lagoa',
  },
  {
    tag: 'Praia do Rosa',
    title: 'Fina Pousada no Coração do Rosa',
    price: 'R$ 3.500.000',
    detail: '8 quartos · 9 banheiros · 475m² · 8 vagas',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/delmo_18-1709664039-800X500.jpg',
    link: '/catalogo.html?q=Fina+Pousada',
  },
  {
    tag: 'Garopaba',
    title: 'Casa a Poucos Metros do Mar',
    price: 'R$ 5.000.000',
    detail: '3 quartos · 4 banheiros · 292m² · 2 vagas',
    img: 'https://imobiliariapraiadorosa.com.br/uploads/media/alan_25-1726514099-800X500.jpg',
    link: '/catalogo.html?q=Casa+em+Garopaba+a+poucos',
  },
];

export default function App() {
  const [recentes, setRecentes] = useState([]);

  useEffect(() => {
    fetch('/api/imoveis?ordenar=recente')
      .then(r => r.json())
      .then(d => setRecentes((d.imoveis || []).slice(0, 6)))
      .catch(() => {});
  }, []);

  function buscar(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const params = new URLSearchParams();
    const tipo = form.querySelector('[name=tipo]').value;
    const bairro = form.querySelector('[name=bairro]').value;
    if (tipo) params.set('tipo', tipo);
    if (bairro) params.set('bairro', bairro);
    window.location.href = `/catalogo.html${params.toString() ? '?' + params : ''}`;
  }

  return (
    <>
      {/* HERO BACKGROUND — imagem fixa estilo banner do site antigo */}
      <div
        className="bg-canvas"
        aria-hidden
        style={{
          backgroundImage: `url(${HERO_BG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#1a1a1a',
        }}
      >
        <div className="bg-veil" />
      </div>

      <div className="page">
        <header className="topnav">
          <div className="brand">
            Babolin
            <small>Properties</small>
          </div>
          <nav>
            <a href="/catalogo.html">Imóveis</a>
            <a href="#regioes">Regiões</a>
            <a href="/sobre.html">Sobre</a>
            <a href="/contato.html">Contato</a>
          </nav>
          <a className="cta" href="https://wa.me/554891493622" target="_blank" rel="noreferrer">
            Falar no WhatsApp
          </a>
        </header>

        {/* HERO CURTO — uma linha só, transparente, 3D atrás */}
        <section className="hero">
          <div className="hero-line">
            <span className="hero-kicker">Praia do Rosa · Imbituba · Garopaba</span>
            <h1>Sua casa <em>onde o mar termina o dia.</em></h1>
            <a className="hero-cta" href="#imoveis">Ver imóveis</a>
          </div>
        </section>

        {/* PROCURANDO IMÓVEL? */}
        <section className="search-bar" id="buscar">
          <div className="search-inner">
            <h2 style={{ gridColumn: '1 / -1', fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500, marginBottom: 10, color: 'var(--text)' }}>
              Procurando imóvel?
            </h2>
            <form onSubmit={buscar} style={{ display: 'contents' }}>
              <div className="search-field">
                <label>Tipo de propriedade</label>
                <select name="tipo" defaultValue="">
                  <option value="">Todos os tipos</option>
                  <option value="casa">Casa</option>
                  <option value="apartamento">Apartamento</option>
                  <option value="terreno">Terreno</option>
                  <option value="sitio">Sítio</option>
                  <option value="outro">Pousada / Outros</option>
                </select>
              </div>
              <div className="search-field">
                <label>Região</label>
                <select name="bairro" defaultValue="">
                  <option value="">Todas as regiões</option>
                  <option value="Praia do Rosa">Praia do Rosa</option>
                  <option value="Ibiraquera">Ibiraquera</option>
                  <option value="Praia da Vigia">Praia da Vigia</option>
                </select>
              </div>
              <div className="search-actions">
                <button className="btn-search" type="submit">Procurar</button>
              </div>
            </form>
          </div>
        </section>

        {/* PROPRIEDADES RECENTES */}
        {recentes.length > 0 && (
          <section className="listings" id="recentes">
            <header className="listings-header">
              <div className="label">Acabou de entrar</div>
              <h2>Propriedades <em>Recentes</em></h2>
              <p>Últimos imóveis adicionados ao catálogo.</p>
            </header>
            <div className="listings-grid">
              {recentes.map(im => (
                <a key={im.id} className="listing-card" href={`/imovel.html?id=${im.id}`}>
                  <div className="listing-img">
                    {im.fotos && im.fotos[0] ? (
                      <img src={im.fotos[0]} alt={im.titulo} loading="lazy" />
                    ) : null}
                  </div>
                  <div className="listing-body">
                    <div className="listing-tag">{im.bairro || im.tipo || 'Imóvel'}</div>
                    <h3>{im.titulo}</h3>
                    <div className="listing-detail">
                      {[
                        im.area_m2 && `${im.area_m2}m²`,
                        im.quartos && `${im.quartos} quartos`,
                        im.banheiros && `${im.banheiros} banheiros`,
                      ].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="listing-price">{fmtBRL(im.preco)}</div>
                  </div>
                </a>
              ))}
            </div>
            <div className="listings-cta">
              <a className="ghost" href="/catalogo.html">Ver catálogo completo →</a>
            </div>
          </section>
        )}

        {/* LISTAGEM */}
        <section className="listings" id="imoveis">
          <header className="listings-header">
            <div className="label">Selecionados a dedo</div>
            <h2>Imóveis em <em>Destaques</em></h2>
            <p>Casas, terrenos, pousadas e apartamentos na Praia do Rosa, Garopaba e Imbituba. Cada imóvel visitado pessoalmente antes de entrar no catálogo.</p>
          </header>

          <div className="listings-grid">
            {LISTINGS.map((item, i) => (
              <a key={i} className="listing-card" href={item.link}>
                <div className="listing-img">
                  <img src={item.img} alt={item.title} loading="lazy" />
                </div>
                <div className="listing-body">
                  <div className="listing-tag">{item.tag}</div>
                  <h3>{item.title}</h3>
                  <div className="listing-detail">{item.detail}</div>
                  <div className="listing-price">{item.price}</div>
                </div>
              </a>
            ))}
          </div>

          <div className="listings-cta">
            <a className="ghost" href="/catalogo.html">Ver catálogo completo →</a>
          </div>
        </section>

        {/* REGIÕES */}
        <section className="listings" id="regioes">
          <header className="listings-header">
            <div className="label">Onde atendemos</div>
            <h2>Região <em>do litoral sul</em></h2>
            <p>Atuação concentrada na faixa entre Garopaba e Imbituba — Praia do Rosa, Ibiraquera, Ferrugem, Vigia, Campo Duna e arredores.</p>
          </header>
          <div className="listings-grid">
            <article className="listing-card">
              <div className="listing-body">
                <div className="listing-tag">Praia do Rosa</div>
                <h3>Casas, pousadas e terrenos</h3>
                <div className="listing-detail">Coração turístico da região. Vista pra lagoa, mata e mar.</div>
              </div>
            </article>
            <article className="listing-card">
              <div className="listing-body">
                <div className="listing-tag">Garopaba</div>
                <h3>Frente mar e condomínios</h3>
                <div className="listing-detail">Casas de praia, áreas para incorporação e oportunidades em condomínio.</div>
              </div>
            </article>
            <article className="listing-card">
              <div className="listing-body">
                <div className="listing-tag">Ibiraquera · Imbituba</div>
                <h3>Terrenos beira de lagoa</h3>
                <div className="listing-detail">Lotes residenciais, áreas para loteamento e sítios estratégicos.</div>
              </div>
            </article>
          </div>
        </section>

        {/* SOBRE */}
        <section className="listings" id="sobre">
          <header className="listings-header">
            <div className="label">Sobre nós</div>
            <h2>Plataforma de anúncios <em>com atendimento direto.</em></h2>
            <p>Trabalhamos com ampla experiência na região e um portfólio variado: casas amplas, apartamentos com vista, pousadas em operação, sítios e terrenos pra investir, morar ou veranear. Igor Babolin é incorporador de condomínios logísticos retroportuários — a plataforma é focada na região da Praia do Rosa e Garopaba e trabalha com anúncios de parceiros corretores que buscam mais visibilidade pros seus produtos.</p>
          </header>
        </section>

        <section className="cta-band" id="contato">
          <h2>Achou o seu? <em>Vamos visitar.</em></h2>
          <p>Atendimento direto pelo WhatsApp, sem corretor-robô no caminho.</p>
          <a className="primary" href="https://wa.me/554891493622" target="_blank" rel="noreferrer">Falar com Igor</a>
        </section>

        <footer className="site-footer">
          <span>© Igor Babolin · Corretor de Imóveis CRECI-SC 55601</span>
          <span>Rua dos Pocianos · Ibiraquera · Praia do Rosa · Imbituba — SC</span>
          <span>
            <a href="https://wa.me/554891493622" target="_blank" rel="noreferrer">WhatsApp (48) 9149-3622</a>
            {' · '}
            <a href="https://www.instagram.com/imobiliariapdr/" target="_blank" rel="noreferrer">@imobiliariapdr</a>
          </span>
        </footer>
      </div>
    </>
  );
}
