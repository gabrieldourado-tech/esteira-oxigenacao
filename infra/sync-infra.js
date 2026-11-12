// Painel do time de Infra (Afiliados) — puxa 100% das tasks de Vini Malvas, Pablo Gabriel e Luis Alexandre
// e grava infra/data.json. Roda no GitHub Actions com o segredo CLICKUP_TOKEN.
//
// O que ele calcula por task:
//  - papel (execução, revisão, deploy, demanda direta), categoria e peso
//  - tempo em cada status (fila x execução x ajuste)
//  - lead time edição → infra (da subtask de edição feita até o done da subtask de infra)
//  - se voltou para ajuste e por quê (status "ajuste/ajustar", campo ⚠️ Quantidade de Alterações e comentários)
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.CLICKUP_TOKEN;
const TEAM = '3076960';
const DIR = __dirname;
const OUT = path.join(DIR, 'data.json');
const CACHE = path.join(DIR, 'cache.json');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const PESSOAS = CONFIG.pessoas; // [{id, nome, cor}]
const JANELA_DIAS = CONFIG.janela_detalhe_dias || 120;   // comentários e task-mãe só para tasks mexidas nesse período ou abertas
const ORCAMENTO_MS = (CONFIG.orcamento_minutos || 22) * 60e3; // tempo máximo por rodada; o resto continua na próxima
const JANELA_DADOS_DIAS = CONFIG.janela_dados_dias || 365;
const IDS = PESSOAS.map((p) => String(p.id));

if (!TOKEN && !process.env.MOCK_API) { console.error('Falta o segredo CLICKUP_TOKEN.'); process.exit(1); }

// ---------- API com controle de ritmo (ClickUp: ~100 req/min por token) ----------
let ultima = 0; let chamadas = 0;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, tentativa = 0) {
  if (process.env.MOCK_API) return require(process.env.MOCK_API)(p);
  const espera = 680 - (Date.now() - ultima);
  if (espera > 0) await dorme(espera);
  ultima = Date.now(); chamadas++;
  const r = await fetch('https://api.clickup.com/api/v2' + p, { headers: { Authorization: TOKEN } });
  if (r.status === 429 && tentativa < 6) {
    const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
    const ms = reset ? Math.max(2000, reset - Date.now() + 500) : 15000;
    console.log(`Limite da API, aguardando ${Math.round(ms / 1000)}s`);
    await dorme(Math.min(ms, 65000));
    return api(p, tentativa + 1);
  }
  if (r.status >= 500 && tentativa < 3) { await dorme(3000); return api(p, tentativa + 1); }
  if (!r.ok) throw new Error(`ClickUp ${r.status} em ${p}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ---------- utilidades ----------
const num = (v) => (v == null || v === '' ? null : Number(v));
const limpa = (s) => String(s || '').replace(/^[^\p{L}\p{N}\[]+/u, '').trim();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const campo = (cfs, trecho) => {
  const f = (cfs || []).find((c) => semAcento(c.name).includes(semAcento(trecho)));
  if (!f || f.value == null || f.value === '' || (Array.isArray(f.value) && !f.value.length)) return null;
  const t = f.type_config || {};
  if (f.type === 'drop_down' && Array.isArray(t.options)) {
    const o = t.options.find((o) => o.id === f.value || o.orderindex === f.value || o.orderindex === Number(f.value));
    return o ? o.name : null;
  }
  if (f.type === 'labels' && Array.isArray(f.value) && Array.isArray(t.options)) {
    return f.value.map((v) => { const o = t.options.find((o) => o.id === (v.id || v)); return o ? (o.label || o.name) : null; }).filter(Boolean).join(', ') || null;
  }
  if (Array.isArray(f.value)) return f.value.map((v) => v.label || v.name || v).join(', ');
  if (typeof f.value === 'object') return f.value.name || f.value.label || null;
  return String(f.value);
};
const statusNome = (s) => (s && (s.status || s)) || '';
const statusTipo = (s) => (s && s.type) || '';
const fechada = (t) => ['closed', 'done'].includes(statusTipo(t.status)) || !!t.date_done || !!t.date_closed;
const feita = (t) => /^(feito|conclu[ií]do|complete|done)$/i.test(statusNome(t.status).trim()) || statusTipo(t.status) === 'closed';
const cancelada = (t) => /cancel|n[aã]o feito/i.test(statusNome(t.status));
const fim = (t) => num(t.date_done) || num(t.date_closed) || (fechada(t) ? num(t.date_updated) : null);

// ---------- classificação ----------
function papelDe(nome, temPai) {
  const n = semAcento(nome);
  if (/revis/.test(n)) return 'revisao';
  if (/subir no apolo|apolo|deploy|publicar/.test(n)) return 'deploy';
  if (/implement|configura|implant/.test(n)) return 'execucao';
  return temPai ? 'execucao' : 'demanda';
}
function categoriaDe(texto) {
  const n = semAcento(texto);
  for (const c of CONFIG.categorias) if (new RegExp(c.regex, 'i').test(n)) return c.nome;
  return 'Outros';
}
function plataformaDe(texto) {
  const n = semAcento(texto);
  for (const [nome, re] of Object.entries(CONFIG.plataformas)) if (new RegExp(re, 'i').test(n)) return nome;
  return null;
}
const RE_AJUSTE = new RegExp(CONFIG.ajuste_regex, 'i');
function motivoDe(texto) {
  const n = semAcento(texto);
  const achados = CONFIG.motivos.filter((m) => new RegExp(m.regex, 'i').test(n)).map((m) => m.nome);
  return achados.length ? achados : ['Não classificado'];
}
function textoComentario(c) {
  if (c.comment_text) return c.comment_text;
  return (c.comment || []).map((x) => x.text || '').join('');
}
const tiraLinks = (s) => String(s || '').replace(/https?:\/\/\S+/g, '[link]').replace(/\s+/g, ' ').trim();
function ehAjuste(texto, autorId, assigneeIds) {
  const t = tiraLinks(texto);
  const so_links = !t.replace(/\[link\]/g, '').replace(/[\s\-–—•:;,.]/g, '');
  if (so_links) return false;
  if (/^\s*(#?ajuste|ajustar|erro)\b/i.test(texto)) return true;
  if (RE_AJUSTE.test(semAcento(t))) return true;
  return false;
}

// ---------- coleta ----------
(async () => {
  const t0 = Date.now();
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { tasks: {}, pais: {} };
  cache.tasks = cache.tasks || {}; cache.pais = cache.pais || {};

  // 1) todas as tasks e subtasks das 3 pessoas, abertas e fechadas
  const brutas = new Map();
  const qsA = IDS.map((id) => `assignees[]=${id}`).join('&');
  for (let page = 0; page < 150; page++) {
    const res = await api(`/team/${TEAM}/task?${qsA}&include_closed=true&subtasks=true&order_by=updated&page=${page}`);
    for (const t of res.tasks || []) brutas.set(t.id, t);
    if (res.last_page !== false || !(res.tasks || []).length) break;
  }
  console.log(`Tasks encontradas: ${brutas.size}`);

  const corte = Date.now() - JANELA_DIAS * 864e5;
  const recente = (t) => !fechada(t) || Number(t.date_updated) >= corte;
  const mudou = (t) => !cache.tasks[t.id] || cache.tasks[t.id].upd !== String(t.date_updated);
  // mais recentes primeiro: se o orçamento acabar, o que falta é o mais antigo
  const novas = [...brutas.values()].filter(mudou).sort((a, b) => Number(b.date_updated) - Number(a.date_updated));
  const estourou = () => Date.now() - t0 > ORCAMENTO_MS;
  let pendentes = 0;
  console.log(`Novas ou alteradas desde a última rodada: ${novas.length}`);

  // 2) tempo em cada status (em lotes de 100)
  for (let i = 0; i < novas.length; i += 100) {
    const lote = novas.slice(i, i + 100);
    const q = lote.map((t) => `task_ids=${t.id}`).join('&');
    let res = {};
    try { res = await api(`/task/bulk_time_in_status/task_ids?${q}`); } catch (e) { console.log('Tempo em status indisponível:', e.message); }
    for (const t of lote) {
      const h = res[t.id];
      const tempos = {};
      if (h) for (const s of [...(h.status_history || [])]) {
        const k = String(s.status || '').toLowerCase();
        tempos[k] = (tempos[k] || 0) + Number((s.total_time && s.total_time.by_minute) || 0);
      }
      cache.tasks[t.id] = { ...(cache.tasks[t.id] || {}), tempos, hist: h ? (h.status_history || []).map((s) => ({ s: String(s.status).toLowerCase(), tipo: s.type, desde: num(s.total_time && s.total_time.since) })) : [] };
    }
  }

  // 3) comentários: só nas tasks de execução (onde o ajuste é comentado) e recentes
  for (const t of novas) {
    let coms = [];
    const querComentario = recente(t) && papelDe(t.name, !!t.parent) !== 'revisao' && papelDe(t.name, !!t.parent) !== 'deploy';
    if (querComentario) {
      if (estourou()) { pendentes++; continue; } // fica para a próxima rodada (upd não é gravado)
      try {
        const res = await api(`/task/${t.id}/comment`);
        coms = res.comments || [];
      } catch (e) { console.log('Comentários indisponíveis em', t.id, e.message); }
    }
    const assignees = (t.assignees || []).map((a) => String(a.id));
    cache.tasks[t.id].coms = coms.map((c) => {
      const texto = textoComentario(c);
      const aj = ehAjuste(texto, String(c.user && c.user.id), assignees);
      return {
        data: num(c.date), autor: (c.user && c.user.username) || '', autor_id: c.user && c.user.id,
        ajuste: aj, motivos: aj ? motivoDe(texto) : [], texto: aj ? tiraLinks(texto).slice(0, 320) : null,
      };
    });
    cache.tasks[t.id].upd = String(t.date_updated);
  }

  // 4) tasks-mãe (para ler a subtask de edição e montar o lead time edição → infra)
  const paisPrecisam = new Set();
  for (const t of brutas.values()) if (t.parent && recente(t) && (!cache.pais[t.parent] || !fechada(t) || (cache.tasks[t.id] && cache.tasks[t.id].paiUpd !== String(t.date_updated)))) paisPrecisam.add(t.parent);
  console.log(`Tasks-mãe para ler: ${paisPrecisam.size}`);
  for (const pid of paisPrecisam) {
    if (estourou()) { pendentes++; continue; }
    try {
      const p = await api(`/task/${pid}?include_subtasks=true`);
      cache.pais[pid] = {
        nome: limpa(p.name), url: p.url, status: statusNome(p.status), criado: num(p.date_created),
        segmentacao: campo(p.custom_fields, 'Segmenta'), produto: campo(p.custom_fields, 'Produto'),
        squad: campo(p.custom_fields, 'Squad') || (p.folder && p.folder.name) || null,
        tipo_tarefa: campo(p.custom_fields, 'Tipo de Tarefa'), classificacao: campo(p.custom_fields, 'Classifica'),
        subs: (p.subtasks || []).map((s) => ({ id: s.id, nome: limpa(s.name), status: statusNome(s.status), tipo: statusTipo(s.status), fim: fim(s), criado: num(s.date_created) })),
      };
    } catch (e) { console.log('Mãe indisponível', pid, e.message); cache.pais[pid] = cache.pais[pid] || { nome: null, subs: [] }; }
  }
  for (const t of brutas.values()) if (t.parent && cache.pais[t.parent] && cache.tasks[t.id]) cache.tasks[t.id].paiUpd = String(t.date_updated);
  // descobrir campos que a busca do time não traz completos (squad/pasta) já vêm no objeto da task.

  // 5) monta as linhas
  const tasks = [];
  const corteDados = Date.now() - JANELA_DADOS_DIAS * 864e5;
  for (const t of brutas.values()) {
    if (fechada(t) && Number(t.date_updated) < corteDados) continue;
    const c = cache.tasks[t.id] || {};
    const pai = t.parent ? cache.pais[t.parent] : null;
    const nome = limpa(t.name);
    const papel = papelDe(t.name, !!t.parent);
    const cfs = t.custom_fields || [];
    const classif = campo(cfs, 'Classificação da Demanda') || (pai && pai.classificacao);
    const seg = campo(cfs, 'Segmenta') || (pai && pai.segmentacao);
    const textoCat = [pai && pai.nome, seg, pai && pai.tipo_tarefa, nome].filter(Boolean).join(' · ');
    const categoria = categoriaDe(textoCat);
    const pesoCampo = num(campo(cfs, 'Peso'));
    const peso = pesoCampo || (CONFIG.pesos[categoria] || CONFIG.pesos.Outros || 1) * (CONFIG.multiplicador_papel[papel] || 1);
    const tempos = c.tempos || {};
    const hist = c.hist || [];
    const reaberta = !fechada(t) && hist.some((h) => h.tipo === 'closed' || h.tipo === 'done');
    const minAjuste = Object.entries(tempos).filter(([k]) => /ajust/.test(k)).reduce((a, [, v]) => a + v, 0);
    const passouAjuste = hist.some((h) => /ajust/.test(h.s));
    const comsAj = (c.coms || []).filter((x) => x.ajuste);
    const qtdCampo = num(campo(cfs, 'Quantidade de Altera'));
    const n_ajustes = Math.max(comsAj.length, qtdCampo || 0, passouAjuste || reaberta ? 1 : 0);

    // edição → infra
    let edicao_fim = null, lead_edicao_h = null;
    if (pai) {
      const ed = pai.subs.filter((s) => /edi[cç][aã]o|editar v[ií]deo/i.test(s.nome) && s.fim);
      if (ed.length) edicao_fim = Math.max(...ed.map((s) => s.fim));
      const f = fim(t);
      if (edicao_fim && f && feita(t)) lead_edicao_h = Math.round(((f - edicao_fim) / 36e5) * 10) / 10;
    }
    const lista = t.list && t.list.name;
    const pasta = t.folder && t.folder.name;
    const espaco = t.space && t.space.id;
    tasks.push({
      id: t.id, url: t.url, nome, pai_id: t.parent || null, pai_nome: pai ? pai.nome : null, pai_url: pai ? pai.url : null,
      lista, pasta, espaco,
      squad: (pai && pai.squad) || campo(cfs, 'Squad') || (espaco === '90135421767' ? 'Demanda direta (Infra)' : null) || (pasta && pasta !== 'hidden' ? pasta : null) || lista,
      produto: campo(cfs, 'Produto') || (pai && pai.produto),
      plataforma: campo(cfs, 'Platform') || plataformaDe(textoCat),
      classificacao: classif || null, segmentacao: seg || null, sprint: campo(cfs, 'Tipo de Sprint'),
      papel, categoria, peso: Math.round(peso * 10) / 10,
      status: statusNome(t.status), status_tipo: statusTipo(t.status),
      cancelada: cancelada(t), feita: feita(t),
      assignees: (t.assignees || []).map((a) => a.id).filter((id) => IDS.includes(String(id))),
      criado: num(t.date_created), inicio: num(t.start_date), prazo: num(t.due_date), fim: fim(t),
      tempos, reaberta, passou_ajuste: passouAjuste, min_ajuste: minAjuste, n_ajustes,
      ajustes: comsAj.map((x) => ({ data: x.data, autor: x.autor, texto: x.texto, motivos: x.motivos })),
      n_comentarios: (c.coms || []).length,
      edicao_fim, lead_edicao_h,
    });
  }

  // limpa cache de tasks que sumiram
  for (const id of Object.keys(cache.tasks)) if (!brutas.has(id)) delete cache.tasks[id];
  const paisUsados = new Set(tasks.map((t) => t.pai_id).filter(Boolean));
  for (const id of Object.keys(cache.pais)) if (!paisUsados.has(id)) delete cache.pais[id];

  const agora = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify({ gerado_em: agora, sincronizado_em: agora, modo: 'real', completo: pendentes === 0, pendentes, pessoas: PESSOAS, config: { pesos: CONFIG.pesos, multiplicador_papel: CONFIG.multiplicador_papel, sla_horas: CONFIG.sla_horas }, tasks }));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`Ficou para a próxima rodada: ${pendentes}`);
  console.log(`infra/data.json gravado: ${tasks.length} tasks · ${chamadas} chamadas · ${Math.round((Date.now() - t0) / 1000)}s`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
