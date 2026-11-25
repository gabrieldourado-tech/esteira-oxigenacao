// Torre de Controle — puxa os dados do ClickUp e grava torre/data.json.
// Roda no GitHub Actions com o segredo CLICKUP_TOKEN (o mesmo do Funnel Ops).
// Fontes: esteiras de Nutrição (materiais prontos), Demandas dos 4 squads + pasta Squad AOV (tasks mãe concluídas),
// lista de Pedidos da CX e o infra/data.json que o Funnel Ops já gera.
const fs = require('fs');
const path = require('path');
const { compute } = require('./compute.js');

const TOKEN = process.env.CLICKUP_TOKEN;
const TEAM = '3076960';
const DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const OUT = path.join(DIR, 'data.json');
const DIA = 864e5;
const JANELA = (CONFIG.semanas + 2) * 7 * DIA; // semanas do gráfico + folga para a comparação

if (!TOKEN) { console.error('Falta o segredo CLICKUP_TOKEN.'); process.exit(1); }

let ultima = 0;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, tentativa = 0) {
  const espera = 700 - (Date.now() - ultima);
  if (espera > 0) await dorme(espera);
  ultima = Date.now();
  const r = await fetch('https://api.clickup.com/api/v2' + p, { headers: { Authorization: TOKEN } });
  if (r.status === 429 && tentativa < 6) {
    const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
    await dorme(Math.min(65000, reset ? Math.max(2000, reset - Date.now() + 500) : 15000));
    return api(p, tentativa + 1);
  }
  if (r.status >= 500 && tentativa < 3) { await dorme(3000); return api(p, tentativa + 1); }
  if (!r.ok) throw new Error(`ClickUp ${r.status} em ${p}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// Pagina /team/{id}/task (100 por página) com filtros prontos na query
async function tarefasTime(query) {
  const todas = [];
  for (let page = 0; page < 60; page++) {
    const r = await api(`/team/${TEAM}/task?${query}&page=${page}`);
    todas.push(...(r.tasks || []));
    if (r.last_page || !(r.tasks || []).length) break;
  }
  return todas;
}
const qs = (o) => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${encodeURIComponent(k)}[]=${encodeURIComponent(x)}`) : [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`])).join('&');
const num = (v) => (v == null || v === '' ? null : Number(v));
const fechado = (t) => num(t.date_done) || num(t.date_closed);

async function main() {
  const agora = Date.now();
  const desde = agora - JANELA;

  // 1) Esteiras: cada card é um material pronto. Aberto = "materiais prontos"; fechado = enviado.
  const tipoPorLista = Object.fromEntries(Object.entries(CONFIG.esteiras).map(([tipo, id]) => [id, tipo]));
  const cards = await tarefasTime(qs({ list_ids: Object.values(CONFIG.esteiras), include_closed: 'true', subtasks: 'false', date_created_gt: desde, order_by: 'created' }));
  const esteira = cards.map((t) => {
    const nome = t.name || '';
    const tipo = tipoPorLista[t.list && t.list.id];
    const produto = tipo === 'ads' ? ((nome.match(/^\[[^\]]+\]\[([^\]]+)\]/) || [])[1] || 'Outros') : nome.split(':')[0].trim();
    return { tipo, produto, nome, url: t.url, criado: num(t.date_created), aberto: !(t.status && ['closed', 'done'].includes(t.status.type)) };
  }).filter((e) => e.tipo);
  console.log('esteira:', esteira.length);

  // 2) Squads: tasks mãe concluídas como "feito"
  const listaSquad = Object.entries(CONFIG.squads_listas);
  const aovListas = (await api(`/folder/${CONFIG.pasta_aov}/list?archived=false`)).lists.map((l) => l.id);
  const brutas = await tarefasTime(qs({ list_ids: [...listaSquad.map(([, id]) => id), ...aovListas], include_closed: 'true', subtasks: 'false', statuses: ['feito'], date_done_gt: desde }));
  const squadDe = (t) => { const id = t.list && t.list.id; const s = listaSquad.find(([, l]) => l === id); return s ? s[0] : aovListas.includes(id) ? 'AOV' : null; };
  const squads = brutas.map((t) => ({ squad: squadDe(t), nome: t.name || '', fechado: fechado(t) })).filter((t) => t.squad && t.fechado);
  console.log('squads:', squads.length);

  // 3) Pedidos da CX
  const pedidos = await tarefasTime(qs({ list_ids: [CONFIG.lista_cx], include_closed: 'true', subtasks: 'false' }));
  const cx = pedidos.map((t) => {
    const nome = t.name || '';
    const m = nome.match(/Solicita[cç][aã]o de (.+?)(?: \(|\s+para\s)/i);
    const af = nome.match(/para\s+(.+?)\s+<>/i);
    return { nome, status: (t.status && t.status.status) || '', tipo: m ? m[1].toLowerCase() : 'material', afiliado: af ? af[1] : nome };
  });
  console.log('cx:', cx.length);

  // 4) Infra: reaproveita o que o Funnel Ops já calcula
  let infra = [];
  try { infra = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'infra', 'data.json'), 'utf8')).tasks || []; } catch (e) { console.log('sem infra/data.json:', e.message); }

  const dados = compute({ esteira, squads, cx, infra, agora, nSemanas: CONFIG.semanas, fontes: { clickup: true, infra: infra.length > 0, vendas: false } });
  fs.writeFileSync(OUT, JSON.stringify(dados));
  console.log('ok:', dados.kpis.map((k) => `${k.id}=${k.valor == null ? '—' : Math.round(k.valor)}`).join(' '));
}

main().catch((e) => { console.error(e); process.exit(1); });
