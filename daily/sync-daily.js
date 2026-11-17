// Painel da Daily (Nutrição) — puxa do ClickUp as subtarefas de Copy e Edição dos Squads 1, 2, 3 e 4
// e grava daily/data.json. Roda no GitHub Actions com o segredo CLICKUP_TOKEN.
//
// O que vai para o painel:
//  - todas as subtarefas ABERTAS com Setores = Copy ou Edição nas listas "Demandas do Squad"
//    (a página filtra por data de vencimento; sem filtro de data aqui porque a API filtra mal subtarefas)
//  - as subtarefas FEITAS nos últimos dias (para mostrar o que cada um entregou desde a última daily)
//  - para cada uma: tarefa mãe, etapa logo acima, squad, prioridade e status da mãe (detecta órfãs)
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.CLICKUP_TOKEN;
const TEAM = '3076960';
const OUT = path.join(__dirname, 'data.json');

const LISTAS = {
  '901329177364': 'S1',
  '901329177473': 'S2',
  '901329177474': 'S3',
  '901329176656': 'S4'
};
const CAMPO_SETORES = '2c615d73-e8a2-48c8-8afd-995ac70b1a29';
const SETOR = {
  'b97e8ca5-3910-4cb1-b06a-2c38cf35ab47': 'Copy',
  '60eba82b-2c5e-4dfe-b41f-024e7f0a7b6e': 'Edição'
};
const IGNORAR_PESSOAS = new Set(['3139651']); // Instituto Experience
const DIAS_ENTREGUES = 5; // cobre fim de semana e feriado

if (!TOKEN && !process.env.MOCK_API) { console.error('Falta o segredo CLICKUP_TOKEN.'); process.exit(1); }

// ---------- API com controle de ritmo (ClickUp: ~100 req/min por token) ----------
let ultima = 0; let chamadas = 0;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, tentativa = 0) {
  if (process.env.MOCK_API) { chamadas++; return require(process.env.MOCK_API)(p); }
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

const num = (v) => (v == null || v === '' ? null : Number(v));
const PRIORIDADE = { urgent: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baixa' };

function setoresDe(t) {
  const f = (t.custom_fields || []).find((c) => c.id === CAMPO_SETORES);
  const v = f && Array.isArray(f.value) ? f.value : [];
  return [...new Set(v.map((x) => SETOR[x && x.id ? x.id : x]).filter(Boolean))];
}

async function buscar(extra) {
  const qs = [
    ...Object.keys(LISTAS).map((id) => `list_ids[]=${id}`),
    'subtasks=true',
    `custom_fields=${encodeURIComponent(JSON.stringify([{ field_id: CAMPO_SETORES, operator: 'ANY', value: Object.keys(SETOR) }]))}`,
    extra
  ].join('&');
  const todas = [];
  for (let page = 0; page < 60; page++) {
    const res = await api(`/team/${TEAM}/task?${qs}&page=${page}`);
    const ts = res.tasks || [];
    todas.push(...ts);
    if (res.last_page !== false || !ts.length) break;
  }
  return todas;
}

async function main() {
  const t0 = Date.now();
  const abertasBrutas = await buscar('include_closed=false');
  const desde = Date.now() - DIAS_ENTREGUES * 864e5;
  const feitasBrutas = await buscar(`include_closed=true&date_done_gt=${desde}`);

  // status do tipo "done" (cancelado, não feito) não contam como abertos nem como entregues
  const abertas = abertasBrutas.filter((t) => !['done', 'closed'].includes(t.status && t.status.type));
  const feitas = feitasBrutas.filter((t) => t.status && t.status.type === 'closed' && num(t.date_done || t.date_closed) >= desde);

  // ---------- tarefas mães e etapas ----------
  const pais = new Map();
  async function pai(id) {
    if (!id) return null;
    if (pais.has(id)) return pais.get(id);
    let p = null;
    try {
      const t = await api(`/task/${id}`);
      p = {
        id: t.id,
        nome: t.name,
        status: t.status ? t.status.status : null,
        status_tipo: t.status ? t.status.type : null,
        prioridade: t.priority ? (PRIORIDADE[t.priority.priority] || t.priority.priority) : null,
        parent: t.parent || null
      };
    } catch (e) {
      console.log('Não consegui ler a tarefa', id, '-', e.message);
    }
    pais.set(id, p);
    return p;
  }

  async function montar(t, entregue) {
    const direto = await pai(t.parent);
    let raiz = direto;
    let guarda = 0;
    while (raiz && raiz.parent && guarda++ < 5) raiz = (await pai(raiz.parent)) || raiz;
    const etapa = direto && raiz && direto.id !== raiz.id ? direto : null;
    const pessoas = (t.assignees || []).filter((a) => !IGNORAR_PESSOAS.has(String(a.id)));
    return {
      id: t.id,
      setores: setoresDe(t),
      tarefa: t.name,
      status: t.status ? t.status.status : '',
      status_tipo: t.status ? t.status.type : '',
      responsaveis: pessoas.map((a) => ({ id: String(a.id), nome: a.username, iniciais: a.initials || null, cor: a.color || null, foto: a.profilePicture || null })),
      vencimento: num(t.due_date),
      inicio: num(t.start_date),
      criada: num(t.date_created),
      atualizada: num(t.date_updated),
      feita_em: entregue ? num(t.date_done || t.date_closed) : null,
      squad: LISTAS[t.list && t.list.id] || null,
      mae_id: raiz ? raiz.id : null,
      mae: raiz ? raiz.nome : null,
      mae_status: raiz ? raiz.status : null,
      mae_fechada: !!(raiz && ['done', 'closed'].includes(raiz.status_tipo)),
      mae_prioridade: raiz ? raiz.prioridade : null,
      etapa: etapa ? etapa.nome : null,
      url: t.url || `https://app.clickup.com/t/${t.id}`
    };
  }

  const tarefas = [];
  for (const t of abertas) tarefas.push(await montar(t, false));
  const entregues = [];
  for (const t of feitas) entregues.push(await montar(t, true));

  const dados = {
    sincronizado_em: new Date().toISOString(),
    fonte: 'ClickUp · listas "Demandas do Squad" dos Squads 1-4 · Setores = Copy ou Edição',
    dias_entregues: DIAS_ENTREGUES,
    tarefas,
    entregues
  };
  fs.writeFileSync(OUT, JSON.stringify(dados));
  console.log(`Abertas: ${tarefas.length} · entregues (${DIAS_ENTREGUES}d): ${entregues.length} · mães lidas: ${pais.size} · chamadas: ${chamadas} · ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
