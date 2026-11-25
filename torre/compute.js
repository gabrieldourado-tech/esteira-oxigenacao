// Torre de Controle — cálculo dos indicadores (puro, sem API).
// Recebe os registros normalizados (esteira, squads, cx, infra) e devolve o data.json do painel.
const DIA = 864e5;
const FUSO = 3 * 3600e3; // America/Fortaleza (UTC-3, sem horário de verão)

const SQUADS = [
  { id: 'S1', nome: 'Squad 1', sub: 'Ads' },
  { id: 'S2', nome: 'Squad 2', sub: 'Ads' },
  { id: 'S3', nome: 'Squad 3', sub: 'Ads' },
  { id: 'S4', nome: 'Squad 4', sub: 'Leads e Microleads' },
  { id: 'AOV', nome: 'Squad AOV', sub: 'Upsells e ticket médio' },
];

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mediana = (a) => {
  const v = a.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const pct = (a, b) => (b ? (a / b) * 100 : null);
const varPct = (atual, ant) => (ant ? ((atual - ant) / ant) * 100 : null);

// Segunda-feira 00:00 (Fortaleza) da semana do timestamp, em ms UTC
function inicioSemana(ts) {
  const local = new Date(ts - FUSO);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = segunda
  const d0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DIA;
  return d0 + FUSO;
}
const rotuloSemana = (ini) => {
  const d = new Date(ini - FUSO);
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
};

// ---------- classificação das demandas dos squads ----------
function categoria(nome) {
  const n = semAcento(nome);
  if (/upsell|orderbump|order bump/.test(n)) return 'Upsell';
  if (/follow|aff\b|afiliado|cpa|saque|rev\b|low-ticket|conversar/.test(n) || /📞/.test(nome)) return 'Afiliado';
  if (/\bads?\b|\bhooks?\b|criativ|reviews?/.test(n)) return 'Criativos';
  if (/microlead|lead/.test(n)) return 'Leads';
  if (/troca de pote/.test(n)) return 'Troca de pote';
  if (/preco|offer|oferta|black ?friday|low ?price/.test(n)) return 'Preço e oferta';
  if (/presell|backredirect|layout|pagina/.test(n)) return 'Páginas';
  return 'Outros';
}
// Quantidade de peças numa demanda: "Leva de 15 Novos Ads" = 15, "Criação de 02 Novas Leads" = 2
function quantidade(nome, cat) {
  const n = semAcento(nome);
  if (cat === 'Criativos') {
    const m = n.match(/(\d+)\s+(novos\s+|novas\s+)?(ads|hooks|videos?-?reviews|ads de imagem)/);
    return m ? Number(m[1]) : 0;
  }
  if (cat === 'Leads') {
    const m = n.match(/(\d+)\s+nov[ao]s?\s+(variac[a-z]* de\s+)?(lead|microlead)/);
    return m ? Number(m[1]) : 0;
  }
  return 0;
}
const ehMicro = (nome) => /microlead/i.test(nome);

const NICHO_PT = {
  'lung': 'Pulmão', 'lungs': 'Pulmão', 'memory loss': 'Memória', 'weight loss': 'Emagrecimento', 'skin': 'Pele',
  'male enhancement': 'Masculino', 'diabetes': 'Diabetes', 'vision': 'Visão', 'hair loss': 'Cabelo',
  'joint pain': 'Articulações', 'blood pressure': 'Pressão', 'hooks': 'Hooks',
};
const nomeProduto = (p) => {
  const k = semAcento(p).replace(/\s+/g, '');
  const MAP = { sodapeak: 'SodaPeak', memohoney: 'MemoHoney', breathizen: 'BreathiZen', vapocept: 'VapoCept', sugarreset: 'Sugar Reset' };
  return MAP[k] || p;
};

function compute({ esteira = [], squads = [], cx = [], infra = [], agora = Date.now(), vendas = null, fontes = {}, nSemanas = 8 }) {
  const fim = agora;
  const ini7 = fim - 7 * DIA;
  const ini14 = fim - 14 * DIA;
  const ini28 = fim - 28 * DIA;
  const noJanela = (ts, a, b) => ts != null && ts >= a && ts < b;

  // ---------- semanas (8, segunda a domingo) ----------
  const semAtual = inicioSemana(fim);
  const semanas = [];
  for (let i = nSemanas - 1; i >= 0; i--) semanas.push(semAtual - i * 7 * DIA);
  const idxSemana = (ts) => {
    const s = inicioSemana(ts);
    return semanas.indexOf(s);
  };

  // ---------- esteira (materiais prontos para afiliado) ----------
  const est7 = esteira.filter((e) => noJanela(e.criado, ini7, fim));
  const estAnt = esteira.filter((e) => noJanela(e.criado, ini14, ini7));
  const porTipo = (arr) => ({ ads: arr.filter((e) => e.tipo === 'ads').length, lead: arr.filter((e) => e.tipo === 'lead').length, pote: arr.filter((e) => e.tipo === 'pote').length });
  const esteiraSemanal = semanas.map((s) => ({ semana: s, rotulo: rotuloSemana(s), parcial: s === semAtual, ads: 0, lead: 0, pote: 0 }));
  esteira.forEach((e) => { const i = idxSemana(e.criado); if (i >= 0) esteiraSemanal[i][e.tipo]++; });

  const abertos = esteira.filter((e) => e.aberto).map((e) => ({ produto: nomeProduto(e.produto), tipo: e.tipo, dias: Math.max(0, Math.floor((fim - e.criado) / DIA)), nome: e.nome || null, url: e.url || null }))
    .sort((a, b) => b.dias - a.dias);

  // produtos (leads e trocas) e nichos (ads) nas últimas 4 semanas
  const conta = (arr, chave) => { const m = new Map(); arr.forEach((x) => { const k = chave(x); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n); };
  const est28 = esteira.filter((e) => noJanela(e.criado, ini28, fim));
  const produtos = conta(est28.filter((e) => e.tipo !== 'ads'), (e) => nomeProduto(e.produto));
  const nichos = conta(est28.filter((e) => e.tipo === 'ads'), (e) => NICHO_PT[semAcento(e.produto)] || e.produto);

  // ---------- squads ----------
  const sq = squads.map((t) => { const cat = categoria(t.nome); return { ...t, cat, qtd: quantidade(t.nome, cat), micro: ehMicro(t.nome) }; });
  const sq7 = sq.filter((t) => noJanela(t.fechado, ini7, fim));
  const sqAnt = sq.filter((t) => noJanela(t.fechado, ini14, ini7));
  const squadsOut = SQUADS.map((s) => {
    const a = sq7.filter((t) => t.squad === s.id); const b = sqAnt.filter((t) => t.squad === s.id);
    const mix = {}; a.forEach((t) => { mix[t.cat] = (mix[t.cat] || 0) + 1; });
    const semanal = semanas.map((w) => sq.filter((t) => t.squad === s.id && inicioSemana(t.fechado) === w).length);
    return { ...s, entregas: a.length, anterior: b.length, mix, semanal };
  });
  const somaQtd = (arr, cat, f = () => true) => arr.filter((t) => t.cat === cat && f(t)).reduce((s, t) => s + t.qtd, 0);
  const criativos7 = somaQtd(sq7, 'Criativos'); const criativosAnt = somaQtd(sqAnt, 'Criativos');
  const leads7 = somaQtd(sq7, 'Leads'); const leadsAnt = somaQtd(sqAnt, 'Leads');
  const criativosSemanal = semanas.map((w) => sq.filter((t) => t.cat === 'Criativos' && inicioSemana(t.fechado) === w).reduce((s, t) => s + t.qtd, 0));
  const mixTotal = {}; sq7.forEach((t) => { mixTotal[t.cat] = (mixTotal[t.cat] || 0) + 1; });
  const upsells7 = sq7.filter((t) => t.squad === 'AOV' && /criacao de novo upsell/.test(semAcento(t.nome))).length;
  const upsellsAnt = sqAnt.filter((t) => t.squad === 'AOV' && /criacao de novo upsell/.test(semAcento(t.nome))).length;
  const followups28 = sq.filter((t) => t.squad === 'AOV' && t.cat === 'Afiliado' && noJanela(t.fechado, ini28, fim)).length;

  // ---------- infra (demandas com edição: edição pronta → infra entregue) ----------
  const grupos = new Map();
  infra.filter((t) => t.pai_id && t.tem_edicao && !t.cancelada && ['execucao', 'revisao', 'deploy'].includes(t.papel)).forEach((t) => {
    if (!grupos.has(t.pai_id)) grupos.set(t.pai_id, []); grupos.get(t.pai_id).push(t);
  });
  const demandas = [];
  grupos.forEach((arr) => {
    if (!arr.every((t) => t.feita)) return;
    const leads = arr.map((t) => t.lead_edicao_h).filter((x) => x != null);
    if (!leads.length) return;
    demandas.push({ lead: Math.max(...leads), fim: Math.max(...arr.map((t) => t.fim || 0)), squad: arr[0].squad });
  });
  const dem7 = demandas.filter((d) => noJanela(d.fim, ini7, fim));
  const demAnt = demandas.filter((d) => noJanela(d.fim, ini14, ini7));
  const sla = (arr) => (arr.length ? (arr.filter((d) => d.lead <= 24).length / arr.length) * 100 : null);
  const infraSemanal = semanas.map((w) => { const a = demandas.filter((d) => inicioSemana(d.fim) === w); return { rotulo: rotuloSemana(w), n: a.length, mediana: mediana(a.map((d) => d.lead)), sla: sla(a), parcial: w === semAtual }; });
  const infraEntregas7 = infra.filter((t) => t.feita && noJanela(t.fim, ini7, fim)).length;
  const infraEntregasAnt = infra.filter((t) => t.feita && noJanela(t.fim, ini14, ini7)).length;
  const infraAbertas = infra.filter((t) => !t.feita && !t.cancelada && t.status_tipo !== 'done' && t.status_tipo !== 'closed');
  const infraAtrasadas = infraAbertas.filter((t) => t.prazo && t.prazo + DIA < fim).length;

  // ---------- CX ----------
  const cxValidos = cx.filter((p) => !/exemplo/i.test(p.nome || ''));
  const criadas = cxValidos.filter((p) => /demanda criada|criado/.test(p.status));
  const canceladas = cxValidos.filter((p) => /cancel/.test(p.status));
  const emFila = cxValidos.filter((p) => /analise|aprovada|an[aá]lise/.test(semAcento(p.status)));
  const tiposCx = conta(criadas, (p) => p.tipo);
  const afiliadosCx = new Set(criadas.map((p) => p.afiliado)).size;

  // ---------- KPIs da semana ----------
  const kpis = [
    { id: 'materiais', rotulo: 'Materiais prontos pros afiliados', valor: est7.length, anterior: estAnt.length, detalhe: `${porTipo(est7).ads} packs de ads · ${porTipo(est7).lead} leads · ${porTipo(est7).pote} trocas de pote` },
    { id: 'criativos', rotulo: 'Criativos produzidos', valor: criativos7, anterior: criativosAnt, detalhe: 'anúncios e hooks entregues pelos squads' },
    { id: 'leads', rotulo: 'Leads e microleads novas', valor: leads7, anterior: leadsAnt, detalhe: 'peças de lead entregues pelo Squad 4' },
    { id: 'entregas', rotulo: 'Demandas concluídas', valor: sq7.length, anterior: sqAnt.length, detalhe: 'tasks mãe fechadas nos 5 squads' },
    { id: 'sla', rotulo: 'Infra em até 24 h', valor: sla(dem7), anterior: sla(demAnt), unidade: '%', meta: 80, detalhe: `edição pronta → infra entregue · mediana ${fmtH(mediana(dem7.map((d) => d.lead)))}` },
  ];

  // ---------- narrativa (a semana em poucas linhas) ----------
  const narrativa = [];
  const dir = (a, b) => (b == null || a == null ? '' : a > b ? 'acima' : a < b ? 'abaixo' : 'igual');
  const v = (a, b) => { const p = varPct(a, b); return p == null ? '' : ` (${p > 0 ? '+' : ''}${Math.round(p)}% vs. 7 dias anteriores)`; };
  narrativa.push(`A operação entregou **${est7.length} materiais prontos** para os afiliados nos últimos 7 dias${v(est7.length, estAnt.length)}, sendo ${porTipo(est7).lead} leads e microleads, ${porTipo(est7).pote} trocas de pote e ${porTipo(est7).ads} packs de ads.`);
  if (criativos7 || criativosAnt) narrativa.push(`Os squads produziram **${criativos7} criativos**${v(criativos7, criativosAnt)} e **${leads7} leads e microleads** novas, em ${sq7.length} demandas concluídas.`);
  const topSq = [...squadsOut].sort((a, b) => b.entregas - a.entregas)[0];
  if (topSq && topSq.entregas) narrativa.push(`O ${topSq.nome} foi o que mais entregou (${topSq.entregas} demandas). ${produtos[0] ? `O produto que mais recebeu material no último mês foi **${produtos[0].nome}** (${produtos[0].n} peças)` : ''}${nichos[0] ? `, e o nicho com mais packs de ads foi **${nichos[0].nome}** (${nichos[0].n})` : ''}.`);
  const s7 = sla(dem7);
  if (s7 != null) narrativa.push(`Na infra, **${Math.round(s7)}% das demandas** saíram em até 24 h depois da edição pronta (meta: 80%)${s7 < 80 ? ', **o principal gargalo da semana**' : ''}. A mediana foi de ${fmtH(mediana(dem7.map((d) => d.lead)))}.`);
  if (criadas.length) narrativa.push(`A CX já pediu **${criadas.length} demandas pelo fluxo automático**, para ${afiliadosCx} afiliados diferentes, sem passar pela gestão.${abertos.length ? ` Há **${abertos.length} materiais prontos** aguardando envio.` : ''}`);

  return {
    gerado_em: new Date().toISOString(),
    referencia: new Date(fim).toISOString(),
    fontes,
    janela: { ini7, fim },
    kpis,
    narrativa,
    esteira: { semanal: esteiraSemanal, semana: porTipo(est7), total28: est28.length, abertos, produtos: produtos.slice(0, 8), nichos: nichos.slice(0, 8) },
    squads: squadsOut,
    semanas: semanas.map(rotuloSemana),
    criativosSemanal,
    mix: Object.entries(mixTotal).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n),
    aov: { upsells7, upsellsAnt, followups28 },
    infra: { semanal: infraSemanal, sla7: s7, slaAnt: sla(demAnt), mediana7: mediana(dem7.map((d) => d.lead)), demandas7: dem7.length, entregas7: infraEntregas7, entregasAnt: infraEntregasAnt, abertas: infraAbertas.length, atrasadas: infraAtrasadas, meta: 80 },
    cx: { total: cxValidos.length, criadas: criadas.length, canceladas: canceladas.length, emFila: emFila.length, tipos: tiposCx, afiliados: afiliadosCx },
    vendas,
  };
}
function fmtH(h) { if (h == null) return '—'; return h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1).replace('.', ',')} dias`; }

module.exports = { compute, categoria, quantidade, inicioSemana };
