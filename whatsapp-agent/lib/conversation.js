// Orquestrador da conversa: recebe mensagem do lead -> monta contexto -> chama Groq -> envia resposta.
import { chat } from './groq.js';
import { resumoCatalogo, linkImovel, imovelPorId, formatarImovelDestaque } from './catalogo.js';
import { getRecentMessages, findOrCreateLeadByPhone, saveMessage, touchLead, syncLeadToIgor } from './storage.js';
import { sendText, resolveLidToPhone, setTyping, downloadMediaFromUrl } from './waha.js';
import { transcribeAudio } from './transcribe.js';
import { log } from './logger.js';

const IGOR_DNA = {
  nome: process.env.IGOR_NOME || 'Igor Babolin',
  creci: process.env.IGOR_CRECI || '55601',
  whatsapp: process.env.IGOR_WHATSAPP || '4891493622',
  regiao: process.env.IGOR_REGIAO || 'Praia do Rosa, Garopaba e Imbituba (SC)',
  site: process.env.IGOR_SITE || 'https://babolin.tech',
};

async function buildSystemPrompt() {
  const catalogo = await resumoCatalogo();

  // Imovel do anuncio atual (Meta Ads). Quando setado, IA abre direto nele.
  const promotedId = process.env.BROADCAST_PROMOTED_PROPERTY_ID || '';
  let destaque = null;
  if (promotedId) {
    const p = await imovelPorId(promotedId.trim());
    destaque = formatarImovelDestaque(p);
  }

  return `Voce e o ASSISTENTE DIGITAL do ${IGOR_DNA.nome}, corretor na Praia do Rosa/Garopaba/Imbituba (SC, CRECI ${IGOR_DNA.creci}).
Seu unico papel: FILTRAR o lead — coletar informacao basica e entregar pro Igor fechar. Voce NAO fecha venda, NAO agenda, NAO negocia. Voce qualifica e passa adiante.

ESTILO DE ESCRITA (CRITICO — esse e o tom):
Mensagens devem soar como humano digitando rapido no WhatsApp. Curto, com conector natural antes da pergunta. NUNCA robotico, NUNCA formulario.

EXEMPLOS BONS (siga esse estilo):
"Mas esta interessado no imovel?"
"Entendi. Pra comprar ou alugar?"
"Boa. Pra voce morar entao?"
"E quantos quartos voce precisa?"
"Certo. Tem ideia de valor?"
"Entendi, e em quanto tempo voce pretende decidir?"

EXEMPLOS RUINS (NUNCA assim):
- Robotico/seco: "Comprar ou alugar?" (sem conector, soa formulario)
- Narrando: "Entendi, voce procura algo no centro para morar sem depender de carro..."
- Paragrafo: 3+ linhas explicando contexto
- 2 perguntas: "Comprar ou alugar? E quantos quartos?"

REGRAS DE ESCRITA:
- Maximo 15 palavras por mensagem.
- Comece com um conector natural curto quando fizer sentido: "Entendi.", "Boa.", "Certo.", "Ok.", "Show.", "E ...". Da fluidez sem narrar.
- NUNCA comece com "Entendi, voce procura X..." parafraseando o lead — robotico ao contrario.
- NUNCA faça 2 perguntas na mesma resposta.
- Portugues coloquial profissional. "voce" por extenso (NUNCA "vc"). "esta" (nao "ta"). "pra" e ok. Sem emoji.
- Sem floreio comercial: nada de "Otimo!", "Perfeito!", "Que legal!".

${destaque ? `IMOVEL DO ANUNCIO:
${destaque}

O lead chegou por anuncio deste imovel especifico. NAO pergunte bairro/regiao/tipo — ja sabemos.

` : ''}PIPELINE DE QUALIFICAÇAO (faça nesta ordem, UMA por turno):
1. Confirmar interesse no imovel (a primeira mensagem ja perguntou isso)
2. Comprar ou alugar?
3. Pra voce morar, investir ou veraneio?
4. Quantos quartos voce precisa, no minimo?
5. Forma de pagamento — a vista, financiamento ou FGTS?
6. Em quanto tempo voce pretende decidir/se mudar?

COMO OPERAR A PIPELINE (REGRA CRITICA — leia com atençao):
Antes de gerar a resposta, FAÇA esta verificaçao mental sobre TODO o historico:

  - Ponto 2 (comprar/alugar): o lead em algum momento disse comprar, alugar, financiar, locaçao, locar, locataria, FGTS? Se sim -> CHECADO.
  - Ponto 3 (perfil): disse morar, residir, familia, investir, veraneio, ferias, locar, ja moro em? Se sim -> CHECADO.
  - Ponto 4 (quartos): mencionou numero de quartos, dormitorios, suite, dois, tres? Se sim -> CHECADO.
  - Ponto 5 (pagamento): disse valor, faixa, financiar, a vista, FGTS, entrada, R$, mil? Se sim -> CHECADO.
  - Ponto 6 (prazo): disse logo, urgente, mes que vem, depois, ainda nao sei, vou pensar? Se sim -> CHECADO.

So pergunte o PROXIMO ponto que NAO esta checado. NUNCA repita pergunta cuja resposta ja esta no historico — mesmo que tenha vindo fora de ordem ou como resposta a outra coisa.

EXEMPLOS de leitura correta:
- Lead disse "vou alugar até vender o meu" -> 2=alugar CHECADO + tambem 3=morar (subentendido) CHECADO. Proximo = 4 (quartos).
- Lead disse "moro hoje no Mirante, preciso voltar pro centro" -> 3=morar CHECADO. Proximo = 2 (comprar/alugar) se nao foi dito.
- Lead disse "quero alugar 2 quartos por 2 mil" -> 2 + 4 + 5 CHECADOS de uma vez. Proximo = 3 ou 6.
- Lead disse so "sim" depois de voce confirmar interesse -> nada checado alem do ponto 1. Proximo = 2.

Se 5+ dos 6 pontos checados, envia filtro pronto:
"Otimo, vou repassar tudo pro Igor e ele te chama por aqui em instantes pra dar os proximos passos."
E pare. Filtro encerrado.

SAIDA DA PIPELINE — se o lead disser:
- "sou proprietario" / "so estou testando" / "sou concorrente" / "sou jornalista" -> "Entendi, obrigado pelo contato. Qualquer imovel que precisar na regiao, estou por aqui." E pare.
- "quero falar com humano" / "atendente" / "pessoa de verdade" -> "Claro, em instantes o Igor te chama por aqui."
- "voce e uma IA?" / "bot?" / "robo?" -> "Sou o assistente digital do Igor. Ele acompanha e entra quando precisar." NUNCA negue. Depois retoma a proxima pergunta da pipeline.
- Linguagem ofensiva -> "Prefiro nao continuar nesse tom. Se precisar de imovel na regiao, estou por aqui." E pare.

ANTI-ALUCINAÇAO:
- So fale com autoridade de imoveis listados no CATALOGO abaixo. Pra qualquer outro nome (bairro, condominio, lugar) que o lead mencionar, voce nao sabe nada — apenas acolha ("entendi, voce conhece o Villa Bela entao") e siga com a proxima pergunta da pipeline. NUNCA descreva nada que nao esteja no catalogo.
- Se o lead manda algo confuso (uma palavra solta, nome proprio, "ok"), pergunte de volta: "Desculpa, nao entendi — pode me explicar?".
- Nunca invente preço, area, caracteristicas, distancias.

USO DO CATALOGO:
- Link de imovel: ${IGOR_DNA.site}/imovel.html?id=ID (substitua ID pelo valor real do campo id). JAMAIS escreva placeholder <id> ou {id}.
- Use o titulo EXATO do imovel como esta no catalogo.
- Site geral: ${IGOR_DNA.site} (catalogo completo, sobre, contato).

CATALOGO ATUAL:
${catalogo}`;
}

// Etapa 1: chamada do webhook assim que chega inbound.
// Resolve LID, transcreve audio (se houver), cria/atualiza lead, persiste no banco.
// Devolve o incoming enriquecido (com phone real + leadId) pra entrar no coalescer.
export async function persistIncoming(incoming) {
  let { phone, pushName, body, evolutionMessageId, mediaType, mediaUrl, mediaMimetype } = incoming;
  const { fromIsLid } = incoming;

  if (fromIsLid) {
    const realPhone = await resolveLidToPhone(phone);
    if (realPhone) {
      log.info('LID resolvido', { lid: phone, phone: realPhone });
      phone = realPhone;
    } else {
      log.warn('Nao foi possivel resolver LID, usando LID como phone', { lid: phone });
    }
  }

  // Se for audio (PTT do WhatsApp = ogg/opus), tenta transcrever pra Groq Whisper
  // antes de salvar. Se rolar, body persistido vira o texto — historico, coalescer
  // e LLM passam a ver a fala como texto normal.
  const looksAudio = mediaType && /^audio\//i.test(mediaType);
  let transcribed = false;
  if (looksAudio && mediaUrl) {
    try {
      const media = await downloadMediaFromUrl(mediaUrl, mediaMimetype);
      if (media?.buffer) {
        const texto = await transcribeAudio(media.buffer, media.mimetype);
        if (texto) {
          body = texto;
          transcribed = true;
          log.info('Audio transcrito', { phone, chars: texto.length, preview: texto.slice(0, 80) });
        }
      }
    } catch (err) {
      log.warn('Falha transcrevendo audio', { phone, err: err.message });
      body = body || '[audio - falha na transcricao]';
    }
  } else if (looksAudio && !mediaUrl) {
    log.warn('Audio recebido sem mediaUrl no payload — verificar config STORE_MEDIA do WAHA', { phone });
  }

  log.info('Inbound recebido', { phone, pushName, mediaType, transcribed, body: body?.slice(0, 80) });

  const lead = await findOrCreateLeadByPhone(phone, { name: pushName || phone });
  await saveMessage({
    phone,
    direction: 'in',
    body,
    leadId: lead.id,
    evolutionMessageId,
    meta: { pushName, mediaType, transcribed },
  });
  // Toca last_whatsapp_at sem mexer no status — status valido so vira 'respondido'
  // apos processBatch enviar resposta. (CHECK constraint: pendente|enviado|respondido|opt_out)
  await touchLead(lead.id);

  return { ...incoming, phone, leadId: lead.id };
}

// Etapa 2: chamada pelo coalescer apos o debounce expirar.
// Recebe 1+ inbounds agrupados, monta resposta unica considerando o batch.
export async function processBatch(batch) {
  if (!batch || batch.length === 0) return null;

  const last = batch[batch.length - 1];
  const { phone, leadId } = last;

  // Concatena bodies do batch em ordem cronologica pra raciocinar como "tudo que o lead disse agora".
  const combinedBody = batch
    .map((m) => (m.body || '').trim())
    .filter(Boolean)
    .join('\n');
  const inboundLen = combinedBody.length;

  log.info('Processando batch', { phone, msgs: batch.length, combinedLen: inboundLen });

  // Curto-circuito: pedido de humano. Status fica 'respondido' (schema atual nao tem
  // 'escalado'); a flag escalate_to_human ja vai na meta da message via opts.escalate.
  if (/humano|atendente|pessoa de verdade/i.test(combinedBody)) {
    return enviarResposta(phone, 'Claro, em instantes o Igor te chama por aqui.', leadId, {
      agent: true, escalate: true, inboundLen,
    });
  }

  // Historico ja contem as inbounds que persistIncoming salvou.
  const recent = await getRecentMessages(phone, 16);
  const historyForLLM = recent.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));

  const system = await buildSystemPrompt();
  const messages = [{ role: 'system', content: system }, ...historyForLLM];

  let resposta;
  try {
    resposta = await chat(messages, { temperature: 0.65, maxTokens: 300 });
  } catch (err) {
    log.error('Falha no Groq', { err: err.message });
    resposta = 'Anotei seu contato! O Igor te responde aqui em instantes.';
  }

  if (!resposta || resposta.length < 5) {
    resposta = 'Anotei sua mensagem. O Igor te chama aqui em instantes.';
  }

  await touchLead(leadId, { whatsapp_status: 'respondido' });
  return enviarResposta(phone, resposta, leadId, { agent: true, inboundLen });
}

function splitInChunks(body) {
  // SO quebra se a IA usou linha em branco real entre paragrafos.
  // Tambem descarta chunks que sao so literal "\n", "\\n\\n" ou whitespace (a Groq
  // ja gerou "\\n\\n" como texto literal — virava bolha vazia/lixo).
  const chunks = body
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter((c) => c && !/^(?:\\?n)+$/i.test(c) && /\S/.test(c.replace(/\\n/g, '')));
  return chunks.length ? chunks : [body];
}

// Detecta se um "phone" no banco e na verdade um LID nao-resolvido.
// LID do WhatsApp tem 14+ digitos. Phone BR valido tem 12 ou 13.
function pareceLid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 14;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter(base, spread) { return base + Math.random() * spread; }

// Tempo de "leitura" antes do Igor começar a digitar. Curto pra resposta
// soar dentro de ~5-6s do inbound chegar.
function tempoLeitura(inboundLen = 0) {
  return Math.min(2500, 800 + Math.max(0, inboundLen) * 25);
}

// Tempo "digitando" — proporcional ao tamanho, teto em 3.5s.
// Mensagens curtas (10-12 palavras = ~60 chars) ficam em ~2s.
function tempoDigitacao(chunkLen) {
  return Math.min(3500, 600 + chunkLen * 50);
}

async function enviarResposta(phone, body, leadId, opts = {}) {
  // LID nao-resolvido agora roteia via phoneToChatId('<lid>@lid') no waha.js,
  // entao nao bloqueamos mais. Apenas registramos no log pra rastreio.
  if (pareceLid(phone)) {
    log.info('Enviando via LID (phone nao resolvido)', { phone, leadId });
  }

  const chunks = splitInChunks(body);
  const results = [];

  // Tempo de "leitura" antes da primeira bolha (deixa o lead ver "online" -> "digitando").
  if (!opts.skipReadDelay) {
    await sleep(tempoLeitura(opts.inboundLen || 0));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const typingMs = tempoDigitacao(chunk.length);
      await setTyping(phone, true);
      await sleep(typingMs);
      await setTyping(phone, false);

      const sent = await sendText(phone, chunk);
      await saveMessage({
        phone,
        direction: 'out',
        body: chunk,
        leadId,
        evolutionMessageId: sent?.key?.id,
        agentResponse: !!opts.agent,
        meta: opts.escalate ? { escalate_to_human: true } : {},
      });
      log.info('Resposta enviada', { phone, chunk: i + 1, of: chunks.length, len: chunk.length, typingMs });
      results.push({ sent: true, body: chunk });

      // Pausa entre bolhas — humano releia o que mandou + decide proxima. 1.4-2.6s.
      if (i < chunks.length - 1) await sleep(jitter(1400, 1200));
    } catch (err) {
      log.error('Falha ao enviar chunk', { phone, chunk: i + 1, err: err.message });
      results.push({ sent: false, error: err.message });
    }
  }
  return results.length === 1 ? results[0] : { sent: true, chunks: results };
}

// Versao usada pelo broadcast / disparo manual.
// Pula o delay de "leitura" porque nao ha inbound — vai direto pro typing.
export async function enviarManual(phone, body, leadId) {
  return enviarResposta(phone, body, leadId, { agent: false, skipReadDelay: true });
}

export { linkImovel };
