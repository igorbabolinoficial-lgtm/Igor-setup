// meta-ads.js — Marketing API do Meta para criação autônoma de campanhas Lead Ads
// Usa System User token permanente (META_SYSTEM_USER_TOKEN) — não expira.

import fs from 'fs';
import path from 'path';
import { log } from './logger.mjs';

const TOKEN      = process.env.META_SYSTEM_USER_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID;   // act_XXXXXX
const PAGE_ID    = process.env.META_PAGE_ID;
const API_BASE   = 'https://graph.facebook.com/v25.0';

// ─── helpers ───────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  const form = new URLSearchParams({ access_token: TOKEN, ...body });
  const r = await fetch(url, { method: 'POST', body: form });
  const json = await r.json();
  if (json.error) throw new Error(`Meta API [${path}]: ${json.error.message}`);
  return json;
}

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams({ access_token: TOKEN, ...params });
  const r = await fetch(`${API_BASE}${path}?${qs}`);
  const json = await r.json();
  if (json.error) throw new Error(`Meta API [${path}]: ${json.error.message}`);
  return json;
}

// ─── 1. Campanha ───────────────────────────────────────────────────────────

export async function criarCampanha({ nome, status = 'PAUSED' }) {
  const res = await apiPost(`/${AD_ACCOUNT}/campaigns`, {
    name: nome,
    objective: 'LEAD_GENERATION',
    status,
    special_ad_categories: '[]',
  });
  log.info('[meta-ads] Campanha criada', { id: res.id, nome });
  return res.id;
}

// ─── 2. Ad Set ─────────────────────────────────────────────────────────────
// segmentacao: { cidades: [{nome, pais}], raioKm, idadeMin, idadeMax, genero }

export async function criarAdSet({
  campanhaId,
  nome,
  orcamentoDiarioBRL,
  segmentacao = {},
  status = 'PAUSED',
}) {
  const {
    cidades = [{ nome: 'Garopaba', pais: 'BR' }, { nome: 'Imbituba', pais: 'BR' }],
    raioKm  = 30,
    idadeMin = 25,
    idadeMax = 65,
    genero   = 0, // 0=todos, 1=homem, 2=mulher
  } = segmentacao;

  // Resolve geo_locations via API
  const geoLocations = await resolverCidades(cidades, raioKm);

  const targeting = {
    geo_locations: JSON.stringify(geoLocations),
    age_min: idadeMin,
    age_max: idadeMax,
    ...(genero !== 0 ? { genders: JSON.stringify([genero]) } : {}),
  };

  const res = await apiPost(`/${AD_ACCOUNT}/adsets`, {
    name: nome,
    campaign_id: campanhaId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: Math.round(orcamentoDiarioBRL * 100), // centavos
    status,
    ...targeting,
  });
  log.info('[meta-ads] AdSet criado', { id: res.id, nome });
  return res.id;
}

async function resolverCidades(cidades, raioKm) {
  const cities = [];
  for (const c of cidades) {
    try {
      const res = await apiGet('/search', {
        type: 'adgeolocation',
        q: c.nome,
        location_types: '["city"]',
        country_code: c.pais || 'BR',
      });
      const hit = (res.data || [])[0];
      if (hit) cities.push({ key: hit.key, radius: raioKm, distance_unit: 'kilometer' });
    } catch (e) {
      log.warn('[meta-ads] Cidade não encontrada', { cidade: c.nome });
    }
  }
  return { cities };
}

// ─── 3. Formulário de Lead ─────────────────────────────────────────────────

export async function criarFormularioLead({
  nome,
  titulo = 'Quero saber mais sobre esse imóvel',
  descricao = 'Preencha e nosso corretor entra em contato rapidinho.',
}) {
  const questions = JSON.stringify([
    { type: 'FULL_NAME' },
    { type: 'PHONE' },
    { type: 'EMAIL' },
    {
      type: 'CUSTOM',
      label: 'Qual imóvel te interessa?',
      key: 'interesse',
    },
  ]);

  const privacyPolicy = JSON.stringify({
    url: 'https://imobiliariapraiadorosa.com.br',
    link_text: 'Política de privacidade',
  });

  const res = await apiPost(`/${PAGE_ID}/leadgen_forms`, {
    name: nome,
    questions,
    privacy_policy: privacyPolicy,
    context_card: JSON.stringify({ title: titulo, content: [descricao] }),
    locale: 'pt_BR',
  });
  log.info('[meta-ads] Formulário criado', { id: res.id });
  return res.id;
}

// ─── 4. Upload de imagem ───────────────────────────────────────────────────
// imagemPath pode ser caminho local (/app/...) ou URL http/https

export async function uploadImagem(imagemPath) {
  let bytes, nome;
  if (/^https?:\/\//i.test(imagemPath)) {
    // URL: baixa direto
    const r = await fetch(imagemPath);
    if (!r.ok) throw new Error(`Falha ao baixar imagem ${imagemPath}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    bytes = Buffer.from(buf);
    nome = imagemPath.split('/').pop().split('?')[0] || 'imagem.jpg';
  } else {
    bytes = fs.readFileSync(imagemPath);
    nome = path.basename(imagemPath);
  }
  const base64 = bytes.toString('base64');
  const res = await apiPost(`/${AD_ACCOUNT}/adimages`, {
    bytes: base64,
    name: nome,
  });
  const hash = Object.values(res.images)[0].hash;
  log.info('[meta-ads] Imagem enviada', { hash, nome });
  return hash;
}

// ─── 5. Criativo ───────────────────────────────────────────────────────────

export async function criarCriativo({ nome, imagemHash, titulo, corpo, formularioId }) {
  const linkData = JSON.stringify({
    image_hash: imagemHash,
    link: `https://fb.me/lead/${formularioId}`,
    message: corpo,
    name: titulo,
    call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: formularioId } },
  });

  const res = await apiPost(`/${AD_ACCOUNT}/adcreatives`, {
    name: nome,
    object_story_spec: JSON.stringify({
      page_id: PAGE_ID,
      link_data: JSON.parse(linkData),
    }),
    degrees_of_freedom_spec: JSON.stringify({ creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } }),
  });
  log.info('[meta-ads] Criativo criado', { id: res.id });
  return res.id;
}

// ─── 6. Anúncio ────────────────────────────────────────────────────────────

export async function criarAnuncio({ adSetId, nome, criativoId, status = 'PAUSED' }) {
  const res = await apiPost(`/${AD_ACCOUNT}/ads`, {
    name: nome,
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: criativoId }),
    status,
  });
  log.info('[meta-ads] Anúncio criado', { id: res.id });
  return res.id;
}

// ─── 7. Fluxo completo ─────────────────────────────────────────────────────
// Cria campanha + ad set + formulário + criativo + anúncio de uma vez.
// Retorna IDs de tudo.

export async function criarLeadAdCompleto({
  nomeCampanha,
  imagemPath,
  titulo,       // headline do anúncio
  corpo,        // texto principal
  orcamentoDiarioBRL = 30,
  segmentacao   = {},
  status        = 'PAUSED', // PAUSED para revisar antes de ativar
}) {
  log.info('[meta-ads] Iniciando criação de Lead Ad', { nomeCampanha });

  const campanhaId    = await criarCampanha({ nome: nomeCampanha, status });
  const adSetId       = await criarAdSet({ campanhaId, nome: `${nomeCampanha} · AdSet`, orcamentoDiarioBRL, segmentacao, status });
  const formularioId  = await criarFormularioLead({ nome: `${nomeCampanha} · Form` });
  const imagemHash    = await uploadImagem(imagemPath);
  const criativoId    = await criarCriativo({ nome: `${nomeCampanha} · Criativo`, imagemHash, titulo, corpo, formularioId });
  const anuncioId     = await criarAnuncio({ adSetId, nome: `${nomeCampanha} · Anúncio`, criativoId, status });

  return { campanhaId, adSetId, formularioId, criativoId, anuncioId };
}

// ─── 8. Utilitários ────────────────────────────────────────────────────────

export async function listarCampanhas() {
  return apiGet(`/${AD_ACCOUNT}/campaigns`, { fields: 'id,name,status,objective' });
}

export async function pausarCampanha(campanhaId) {
  return apiPost(`/${campanhaId}`, { status: 'PAUSED' });
}

export async function ativarCampanha(campanhaId) {
  return apiPost(`/${campanhaId}`, { status: 'ACTIVE' });
}

export async function metricas(campanhaId) {
  return apiGet(`/${campanhaId}/insights`, {
    fields: 'impressions,clicks,spend,leads,cpl',
    date_preset: 'last_7d',
  });
}

export function metaAdsReady() {
  return !!(TOKEN && AD_ACCOUNT && PAGE_ID);
}
