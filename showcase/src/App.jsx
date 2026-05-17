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
    tag: 'Praia do Rosa',
    title: 'Casa Frente Mar',
    price: 'R$ 4.200.000',
    detail: '4 suítes · 380m² · vista lagoa + mar',
    img: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80&auto=format&fit=crop',
  },
  {
    tag: 'Centro · Imbituba',
    title: 'Apartamento Garden',
    price: 'R$ 899.000',
    detail: '2 quartos · 92m² · 1 vaga',
    img: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80&auto=format&fit=crop',
  },
  {
    tag: 'Praia do Rosa',
    title: 'Cobertura Duplex',
    price: 'R$ 6.800.000',
    detail: '3 suítes · 280m² · piscina privativa',
    img: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80&auto=format&fit=crop',
  },
  {
    tag: 'Garopaba',
    title: 'Refúgio na Mata',
    price: 'R$ 2.500.000',
    detail: '3 quartos · 210m² · terreno 1.200m²',
    img: 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80&auto=format&fit=crop',
  },
  {
    tag: 'Vila Nova',
    title: 'Studio Pé na Areia',
    price: 'R$ 2.800/mês',
    detail: '1 quarto · 38m² · temporada',
    img: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80&auto=format&fit=crop',
  },
  {
    tag: 'Praia do Rosa',
    title: 'Terreno Vista Aberta',
    price: 'R$ 1.450.000',
    detail: '1.800m² · pronto pra construir',
    img: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80&auto=format&fit=crop',
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
            <a href="#imoveis">Imóveis</a>
            <a href="#regioes">Regiões</a>
            <a href="#sobre">Sobre</a>
            <a href="#contato">Contato</a>
          </nav>
          <a className="cta" href="https://wa.me/5548999999999" target="_blank" rel="noreferrer">
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
            <p>Poucos clientes por vez. Cada imóvel visitado pessoalmente antes de entrar no catálogo.</p>
          </header>

          <div className="listings-grid">
            {LISTINGS.map((item, i) => (
              <article key={i} className="listing-card">
                <div className="listing-img">
                  <img src={item.img} alt={item.title} loading="lazy" />
                </div>
                <div className="listing-body">
                  <div className="listing-tag">{item.tag}</div>
                  <h3>{item.title}</h3>
                  <div className="listing-detail">{item.detail}</div>
                  <div className="listing-price">{item.price}</div>
                </div>
              </article>
            ))}
          </div>

          <div className="listings-cta">
            <a className="ghost" href="#catalogo">Ver catálogo completo →</a>
          </div>
        </section>

        <section className="cta-band">
          <h2>Achou o seu? <em>Vamos visitar.</em></h2>
          <p>Atendimento direto pelo WhatsApp, sem corretor-robô no caminho.</p>
          <a className="primary" href="https://wa.me/5548999999999" target="_blank" rel="noreferrer">Falar com Igor</a>
        </section>

        <footer className="site-footer">
          <span>© Babolin Properties · CRECI 00000</span>
          <span>Praia do Rosa · Imbituba · Santa Catarina</span>
        </footer>
      </div>
    </>
  );
}
