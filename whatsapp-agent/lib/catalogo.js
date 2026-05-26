// Catalogo via API publica do igor-neural-system (https://imobiliariapraiadorosa.com.br/api/imoveis).
// Cache em memoria de 60s pra nao martelar a API.

const API_BASE = process.env.IGOR_API_BASE || 'https://imobiliariapraiadorosa.com.br';
const CACHE_TTL_MS = 60_000;

let _cache = { ts: 0, data: null };

const fmtBRL = (n) => {
  if (n == null) return 'Sob consulta';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
};

async function fetchTodos() {
  const now = Date.now();
  if (_cache.data && now - _cache.ts < CACHE_TTL_MS) return _cache.data;
  const r = await fetch(`${API_BASE}/api/imoveis`);
  if (!r.ok) throw new Error(`Falha ao buscar catalogo: HTTP ${r.status}`);
  const j = await r.json();
  _cache = { ts: now, data: j.imoveis || [] };
  return _cache.data;
}

export async function listarTodos() {
  return await fetchTodos();
}

// Resume catalogo pro system prompt. Inclui id pro LLM referenciar link correto.
// precoMax: quando informado, filtra imóveis acima desse valor (teto rígido do lead).
export async function resumoCatalogo(precoMax = null) {
  let imoveis = await fetchTodos();
  if (!imoveis.length) return 'Catalogo vazio.';
  // Filtra pelo teto do lead — nunca mostrar acima do orçamento no catálogo
  if (precoMax && precoMax > 0) {
    imoveis = imoveis.filter((p) => !p.preco || p.preco <= precoMax);
  }
  if (!imoveis.length) return `Catalogo vazio para o orçamento informado (máximo R$${precoMax?.toLocaleString('pt-BR')}).`;
  const linhas = imoveis.map((p) => {
    const preco = fmtBRL(p.preco);
    const area = p.area_m2 ? `${p.area_m2}m²` : '';
    const bairro = p.bairro || '';
    const tipo = p.tipo ? `[${p.tipo}]` : '';
    const quartos = p.quartos ? ` · ${p.quartos}q` : '';
    const link = linkImovel(p);
    return `- id=${p.id} · ${tipo} ${p.titulo} — ${preco}${area ? ` · ${area}` : ''}${quartos}${bairro ? ` · ${bairro}` : ''} → ${link}`;
  });
  return linhas.join('\n');
}

export async function buscar(query) {
  if (!query || query.length < 3) return [];
  const r = await fetch(`${API_BASE}/api/imoveis?q=${encodeURIComponent(query)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.imoveis || []).slice(0, 5);
}

// Busca por faixa de preço.
// precoMax é TETO RÍGIDO (nunca mostra acima). precoMin busca 30% abaixo pra dar opções.
// margemAcimaPermitida só sobe acima do precoMax se o caller forçar (default 0 = sem margem acima).
export async function buscarPorPreco(preco, margemAcimaPermitida = 0) {
  const min = Math.floor(preco * 0.70);
  const max = Math.ceil(preco * (1 + margemAcimaPermitida));
  const r = await fetch(`${API_BASE}/api/imoveis?preco_min=${min}&preco_max=${max}&ordenar=preco_asc`);
  if (!r.ok) return [];
  const j = await r.json();
  const imoveis = j.imoveis || [];
  // Ordena pelo mais próximo do teto (não pelo mais barato)
  imoveis.sort((a, b) => Math.abs((a.preco || 0) - preco) - Math.abs((b.preco || 0) - preco));
  return imoveis.slice(0, 3);
}

// Busca por nome/título exato ou parcial
export async function buscarPorNome(nome) {
  if (!nome || nome.length < 3) return [];
  const r = await fetch(`${API_BASE}/api/imoveis?q=${encodeURIComponent(nome)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.imoveis || []).slice(0, 5);
}

// Formata resultado de busca pro bot usar na resposta
export function formatarResultadoBusca(imoveis) {
  if (!imoveis.length) return null;
  return imoveis.map((p) => {
    const preco = fmtBRL(p.preco);
    const area = p.area_m2 ? ` · ${p.area_m2}m²` : '';
    const quartos = p.quartos ? ` · ${p.quartos} quartos` : '';
    const bairro = p.bairro ? ` · ${p.bairro}` : '';
    return `id=${p.id} · ${p.titulo} — ${preco}${area}${quartos}${bairro}\nLink: ${linkImovel(p)}`;
  }).join('\n\n');
}

// Link do imovel — prioriza url_origem (imobiliariapraiadorosa.com.br, site público do Igor)
export function linkImovel(idOuImovel) {
  if (typeof idOuImovel === 'object' && idOuImovel) {
    if (idOuImovel.url_origem) return idOuImovel.url_origem;
    return `${API_BASE}/imovel.html?id=${idOuImovel.id}`;
  }
  return `${API_BASE}/imovel.html?id=${idOuImovel}`;
}

export async function imovelPorId(id) {
  if (!id) return null;
  try {
    const r = await fetch(`${API_BASE}/api/imoveis/${id}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export function formatarImovelDestaque(p) {
  if (!p) return null;
  const preco = fmtBRL(p.preco);
  const area = p.area_m2 ? `${p.area_m2}m²` : '';
  const bairro = p.bairro || '';
  const tipo = p.tipo ? `[${p.tipo}]` : '';
  return `id=${p.id} · ${p.titulo} ${tipo} ${preco}${area ? ` · ${area}` : ''}${bairro ? ` · ${bairro}` : ''}\nLink: ${linkImovel(p)}`;
}
