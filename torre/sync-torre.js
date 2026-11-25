// Torre de Controle — coleta no ClickUp os registros brutos que o painel usa.
// O cálculo (por período escolhido no filtro de data) acontece no navegador, em compute.js.
// Uso direto: `node torre/sync-torre.js` grava torre/data.json (cópia de reserva no site).
// O robô ao vivo (live-torre.js) usa a função rodada() a cada minuto.
const fs = require('fs');
const path = require('path');

const TEAM = '3076960';
const DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const DIA = 864e5;
const JANELA = (CONFIG.janela_dias || 120) * DIA;

const CAMPO = {
  afiliados: '2b88a7ce-6cb2-4dc0-8e14-73bb3f5164bf',
  drive: '35501bc4-3e1b-468b-8976-0fe4ce59cf5a',
  qtd: '75cefdc4-9a26-4968-b689-73b308e5ea92',
  produto: '566f3dee-b212-4274-8c34-e21044d34445',
  nicho: '7dca7c7a-8b14-4020-ae6c-06af8c35a513',
  segmentacao: '7b4ffd6c-5484-4ecb-a389-1306c2b1cb60',
  tracking: 'e41cdd08-6562-40ba-a28f-b0b5697032ef',
};

let ultima = 0;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, tentativa = 0) {
  const espera = 650 - (Date.now() - ultima);
  if (espera > 0) await dorme(espera);
  ultima = Date.now();
  const r = await fetch('https://api.clickup.com/api/v2' + p, { headers: { Authorization: process.env.CLICKUP_TOKEN } });
  if (r.status === 429 && tentativa < 6) {
    const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
    await dorme(Math.min(65000, reset ? Math.max(2000, reset - Date.now() + 500) : 15000));
    return api(p, tentativa + 1);
  }
  if (r.status >= 500 && tentativa < 3) { await dorme(3000); return api(p, tentativa + 1); }
  if (!r.ok) throw new Error(`ClickUp ${r.status} em ${p}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function tarefasTime(query, max = 60) {
  const todas = [];
  for (let page = 0; page < max; page++) {
    const r = await api(`/team/${TEAM}/task?${query}&page=${page}`);
    todas.push(...(r.tasks || []));
    if (r.last_page !== false || !(r.tasks || []).length) break;
  }
  return todas;
}
const qs = (o) => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${encodeURIComponent(k)}[]=${encodeURIComponent(x)}`) : [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`])).join('&');
const num = (v) => (v == null || v === '' ? null : Number(v));
const fechadoEm = (t) => num(t.date_done) || num(t.date_closed);
const tipoStatus = (t) => (t.status && t.status.type) || '';
const statusTx = (t) => String((t.status && t.status.status) || '').toLowerCase();

// ---------- leitura de campos personalizados ----------
const campo = (t, id) => (t.custom_fields || []).find((c) => c.id === id);
function opcao(t, id) {
  const c = campo(t, id); if (!c || c.value == null || c.value === '') return null;
  const ops = (c.type_config && c.type_config.options) || [];
  const v = c.value;
  const o = ops.find((x) => x.id === v || (typeof v === 'number' && x.orderindex === v) || String(x.orderindex) === String(v));
  return o ? (o.name || o.label) : (typeof v === 'object' && v.name) || null;
}
function rotulos(t, id) {
  const c = campo(t, id); if (!c || !Array.isArray(c.value)) return [];
  const ops = (c.type_config && c.type_config.options) || [];
  return c.value.map((v) => { const o = ops.find((x) => x.id === (v.id || v)); return o ? o.label || o.name : v.label || null; }).filter(Boolean);
}
function afiliados(t) {
  const c = campo(t, CAMPO.afiliados); if (!c || !Array.isArray(c.value)) return [];
  return c.value.filter((a) => a && a.id && !a.deleted).map((a) => ({ id: a.id, nome: String(a.name || '').trim(), url: a.url || `https://app.clickup.com/t/${a.id}` }));
}
const texto = (t, id) => { const c = campo(t, id); return c && c.value != null && c.value !== '' ? String(c.value) : null; };

// ---------- normalização ----------
function normEsteira(t, tipoPorLista) {
  const tipo = tipoPorLista[t.list && t.list.id];
  if (!tipo) return null;
  const nome = t.name || '';
  let produto = opcao(t, CAMPO.produto);
  let nicho = opcao(t, CAMPO.nicho);
  if (!produto) produto = tipo === 'ads' ? null : nome.split(':')[0].trim();
  if (tipo === 'ads' && !nicho) nicho = (nome.match(/^\[[^\]]+\]\[([^\]]+)\]/) || [])[1] || null;
  const qtd = num(texto(t, CAMPO.qtd));
  return {
    id: t.id, url: t.url, tipo, nome, produto, nicho,
    seg: rotulos(t, CAMPO.segmentacao)[0] || null,
    criado: num(t.date_created),
    aberto: !['closed', 'done'].includes(tipoStatus(t)),
    status: statusTx(t),
    afiliados: afiliados(t),
    drive: texto(t, CAMPO.drive),
    tracking: texto(t, CAMPO.tracking),
    qtd: qtd && qtd > 0 ? qtd : 1,
  };
}
function normSquad(t, squadDe) {
  const squad = squadDe(t); const fechado = fechadoEm(t);
  if (!squad || !fechado || statusTx(t) !== 'feito') return null;
  return { id: t.id, url: t.url, squad, nome: t.name || '', fechado, produto: opcao(t, CAMPO.produto), afiliados: afiliados(t) };
}
function normCx(t) {
  const nome = t.name || '';
  const desc = String(t.text_content || t.description || '');
  const tipo = (nome.match(/Solicita[cç][aã]o de (.+?)(?: \(|\s+para\s|$)/i) || [])[1];
  const produto = (nome.match(/\(([^)]+)\)/) || [])[1] || null;
  const af = afiliados(t)[0];
  const afNome = af ? af.nome : ((nome.match(/para\s+(.+?)\s*$/i) || [])[1] || '').trim();
  const por = (desc.match(/Solicitado por:\s*\**\s*([^\n*]+)/i) || [])[1];
  return {
    id: t.id, url: t.url, nome, tipo: tipo ? tipo.toLowerCase().trim() : 'material', produto,
    afiliado: afNome || null, afiliado_url: af ? af.url : null,
    status: statusTx(t), criado: num(t.date_created),
    solicitante: por ? por.trim() : null,
  };
}

// ---------- uma rodada de coleta ----------
// estado guarda os registros entre rodadas; incremental = só o que mudou desde `desde`
async function rodada(estado, { incremental = false, desde = 0 } = {}) {
  const inicio = Date.now();
  const corte = inicio - JANELA;
  const tipoPorLista = Object.fromEntries(Object.entries(CONFIG.esteiras).map(([tipo, id]) => [id, tipo]));
  const listaSquad = Object.entries(CONFIG.squads_listas);
  if (!estado.aovListas || !incremental) {
    estado.aovListas = (await api(`/folder/${CONFIG.pasta_aov}/list?archived=false`)).lists.map((l) => ({ id: l.id, nome: l.name }));
  }
  const aovIds = estado.aovListas.map((l) => l.id);
  const squadDe = (t) => { const id = t.list && t.list.id; const s = listaSquad.find(([, l]) => l === id); return s ? s[0] : aovIds.includes(id) ? 'AOV' : null; };
  const filtroTempo = incremental ? { date_updated_gt: Math.floor(desde) } : null;

  // 1) esteiras
  const qEst = { list_ids: Object.values(CONFIG.esteiras), include_closed: 'true', subtasks: 'false', ...(filtroTempo || { date_created_gt: corte }) };
  const cards = await tarefasTime(qs(qEst));
  // 2) squads (busca completa só traz "feito"; a incremental traz tudo que mudou para tirar o que foi reaberto)
  const listasSq = [...listaSquad.map(([, id]) => id), ...aovIds];
  const qSq = incremental
    ? { list_ids: listasSq, include_closed: 'true', subtasks: 'false', ...filtroTempo }
    : { list_ids: listasSq, include_closed: 'true', subtasks: 'false', statuses: ['feito'], date_done_gt: corte };
  const brutasSq = await tarefasTime(qs(qSq));
  // 3) pedidos da CX
  const qCx = { list_ids: [CONFIG.lista_cx], include_closed: 'true', subtasks: 'false', ...(filtroTempo || {}) };
  const pedidos = await tarefasTime(qs(qCx));

  if (!incremental) { estado.esteira = new Map(); estado.squads = new Map(); estado.cx = new Map(); }
  let alteradas = 0;
  const aplica = (mapa, brutas, norm) => {
    for (const t of brutas) {
      const r = norm(t);
      const antes = mapa.get(t.id);
      if (r) { if (!antes || JSON.stringify(antes) !== JSON.stringify(r)) { mapa.set(t.id, r); alteradas++; } }
      else if (antes) { mapa.delete(t.id); alteradas++; }
    }
  };
  aplica(estado.esteira, cards, (t) => normEsteira(t, tipoPorLista));
  aplica(estado.squads, brutasSq, (t) => normSquad(t, squadDe));
  aplica(estado.cx, pedidos, normCx);
  // tira o que saiu da janela
  for (const [id, e] of estado.esteira) if (e.criado < corte) estado.esteira.delete(id);
  for (const [id, s] of estado.squads) if (s.fechado < corte) estado.squads.delete(id);

  const listas = Object.fromEntries([...listaSquad.map(([s, id]) => [s, `https://app.clickup.com/${TEAM}/v/li/${id}`]), ['AOV', `https://app.clickup.com/${TEAM}/v/f/${CONFIG.pasta_aov}`],
    ['esteira_ads', `https://app.clickup.com/${TEAM}/v/li/${CONFIG.esteiras.ads}`], ['esteira_lead', `https://app.clickup.com/${TEAM}/v/li/${CONFIG.esteiras.lead}`], ['esteira_pote', `https://app.clickup.com/${TEAM}/v/li/${CONFIG.esteiras.pote}`],
    ['cx', `https://app.clickup.com/${TEAM}/v/li/${CONFIG.lista_cx}`]]);
  const dados = {
    versao: 2,
    sincronizado_em: new Date(inicio).toISOString(),
    janela_dias: CONFIG.janela_dias || 120,
    fontes: { clickup: true, crm: false, vendas: false },
    listas,
    esteira: [...estado.esteira.values()].sort((a, b) => b.criado - a.criado),
    squads: [...estado.squads.values()].sort((a, b) => b.fechado - a.fechado),
    cx: [...estado.cx.values()].sort((a, b) => (b.criado || 0) - (a.criado || 0)),
  };
  console.log(`${incremental ? 'incremental' : 'completa'}: esteira ${dados.esteira.length} · squads ${dados.squads.length} · cx ${dados.cx.length} · alteradas ${alteradas}`);
  return { dados, alteradas, inicio };
}

module.exports = { rodada };

if (require.main === module) {
  if (!process.env.CLICKUP_TOKEN) { console.error('Falta o segredo CLICKUP_TOKEN.'); process.exit(1); }
  rodada({}, { incremental: false })
    .then(({ dados }) => { fs.writeFileSync(path.join(DIR, 'data.json'), JSON.stringify(dados)); console.log('ok: torre/data.json'); })
    .catch((e) => { console.error(e); process.exit(1); });
}
