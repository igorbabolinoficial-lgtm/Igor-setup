import React, { useEffect, useRef, useState, Suspense, Component } from 'react';
import './App.css';
import Showcase3D from './Showcase3D.jsx';

class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[Showcase3D crash]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="canvas-error">
          <strong>3D não carregou:</strong>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
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

/* Progresso global da página (0 = topo, 1 = fim do scroll). Sem trava nem hero spacer. */
function useGlobalScroll() {
  const scrollRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      const scrolled = window.scrollY || doc.scrollTop || 0;
      scrollRef.current = total > 0 ? Math.max(0, Math.min(1, scrolled / total)) : 0;
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return scrollRef;
}

function useEnvironmentFlags() {
  const [flags, setFlags] = useState({ mobile: false });
  useEffect(() => {
    const mobileMq = window.matchMedia('(max-width: 768px)');
    const update = () => setFlags({ mobile: mobileMq.matches });
    update();
    mobileMq.addEventListener('change', update);
    return () => mobileMq.removeEventListener('change', update);
  }, []);
  return flags;
}

export default function App() {
  const scrollRef = useGlobalScroll();
  const { mobile } = useEnvironmentFlags();
  const quality = mobile ? 'lite' : 'hi';

  return (
    <>
      {/* CANVAS DE FUNDO — fixo, recebe o scroll global da página inteira */}
      <div className="bg-canvas" aria-hidden>
        <div className="canvas-wrap">
          <CanvasErrorBoundary>
            <Suspense fallback={<div className="bg-fallback" />}>
              <Showcase3D scrollRef={scrollRef} quality={quality} />
            </Suspense>
          </CanvasErrorBoundary>
        </div>
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

        {/* BARRA DE BUSCA */}
        <section className="search-bar" id="buscar">
          <div className="search-inner">
            <div className="search-field">
              <label>Tipos de listagem</label>
              <select defaultValue="">
                <option value="" disabled>Selecione o tipo de propriedade</option>
                <option>Casa</option>
                <option>Apartamento</option>
                <option>Terreno</option>
                <option>Cobertura</option>
              </select>
            </div>
            <div className="search-field">
              <label>Tipo de oferta</label>
              <select defaultValue="">
                <option value="" disabled>Selecione a oferta</option>
                <option>Venda</option>
                <option>Aluguel</option>
                <option>Temporada</option>
              </select>
            </div>
            <div className="search-field">
              <label>Selecione a cidade</label>
              <select defaultValue="">
                <option value="" disabled>Selecione qualquer cidade</option>
                <option>Imbituba</option>
                <option>Garopaba</option>
                <option>Praia do Rosa</option>
              </select>
            </div>
            <div className="search-actions">
              <button className="btn-search">Procurar</button>
              <button className="btn-advanced">Busca Avançada</button>
            </div>
          </div>
        </section>

        {/* LISTAGEM */}
        <section className="listings" id="imoveis">
          <header className="listings-header">
            <div className="label">Em destaque</div>
            <h2>Selecionados <em>a dedo</em></h2>
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
          <span>© Babolin Properties · Corretor de Imóveis CRECI-SC</span>
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
