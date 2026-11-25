// Torre de Controle — cálculo dos indicadores para o período escolhido no filtro.
// Roda no navegador (window.Torre) e no Node (require). Puro: sem API, sem DOM.
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m; else raiz.Torre = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const DIA = 864e5, SEM = 7 * DIA;
  const FUSO = 3 * 3600e3; // America/Fortaleza (UTC-3, sem horário de verão)

  const SQUADS = [
    { id: 'S1', nome: 'Squad 1', sub: 'Ads' },
    { id: 'S2', nome: 'Squad 2', sub: 'Ads' },
    { id: 'S3', nome: 'Squad 3', sub: 'Ads' },
    { id: 'S4', nome: 'Squad 4', sub: 'Leads e Microleads' },
    { id: 'AOV', nome: 'Squad AOV', sub: 'Upsells e ticket médio' },
  ];
  const TIPO_NOME = { ads: 'Pack de ads', lead: 'Lead/microlead', pote: 'Troca de pote' };

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- datas no fuso de Fortaleza ----------
  const partes = (ts) => { const d = new Date(ts - FUSO); return { a: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: (d.getUTCDay() + 6) % 7 }; };
  const diaIni = (a, m, d) => Date.UTC(a, m, d) + FUSO; // 00:00 do dia em Fortaleza
  const inicioDia = (ts) => { const p = partes(ts); return diaIni(p.a, p.m, p.d); };
  const inicioSemana = (ts) => inicioDia(ts) - partes(ts).dow * DIA; // segunda 00:00
  const inicioMes = (ts) => { const p = partes(ts); return diaIni(p.a, p.m, 1); };
  const MESC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dm = (ts) => { const p = partes(ts); return String(p.d).padStart(2, '0') + '/' + String(p.m + 1).padStart(2, '0'); };
  const faixaDatas = (ini, fimEx) => { const a = partes(ini), b = partes(fimEx - 1); return a.m === b.m ? `${a.d}–${b.d}/${String(b.m + 1).padStart(2, '0')}` : `${dm(ini)}–${dm(fimEx - 1)}`; };

  // Nome da semana em relação à semana atual
  function nomeSemana(ini, agora, curto) {
    const n = Math.round((inicioSemana(agora) - ini) / SEM);
    if (n === 0) return curto ? 'Esta semana' : 'Esta semana (tempo real)';
    if (n === 1) return 'Semana passada';
    if (n === 2) return 'Semana retrasada';
    if (n < 0) return 'Próxima semana';
    return curto ? `Há ${n} semanas` : `Há ${n} semanas`;
  }

  // ---------- atalhos do filtro de data (estilo Looker Studio) ----------
  function atalhos(agora) {
    const s0 = inicioSemana(agora), d0 = inicioDia(agora), m0 = inicioMes(agora);
    const pm = partes(m0 - DIA); const mAnt = diaIni(pm.a, pm.m, 1);
    const ult = (n) => [d0 - (n - 1) * DIA, agora];
    return [
      { k: 'esta', n: 'Esta semana (tempo real)', r: [s0, agora], semanal: true },
      { k: 'passada', n: 'Semana passada', r: [s0 - SEM, s0], semanal: true },
      { k: 'retrasada', n: 'Semana retrasada', r: [s0 - 2 * SEM, s0 - SEM], semanal: true },
      { k: '4sem', n: 'Últimas 4 semanas fechadas', r: [s0 - 4 * SEM, s0], semanal: true },
      { k: '8sem', n: 'Últimas 8 semanas fechadas', r: [s0 - 8 * SEM, s0], semanal: true },
      { k: 'hoje', n: 'Hoje', r: [d0, agora] },
      { k: 'ontem', n: 'Ontem', r: [d0 - DIA, d0] },
      { k: '7d', n: 'Últimos 7 dias', r: ult(7) },
      { k: '28d', n: 'Últimos 28 dias', r: ult(28) },
      { k: '90d', n: 'Últimos 90 dias', r: ult(90) },
      { k: 'mes', n: 'Este mês', r: [m0, agora] },
      { k: 'mesant', n: 'Mês passado', r: [mAnt, m0] },
    ];
  }
  // Período de comparação: semanas comparam com as semanas anteriores (mesmo trecho da semana,
  // se a atual ainda está em andamento); o resto compara com o período anterior de mesma duração.
  function comparacao(ini, fim) {
    const L = fim - ini;
    if (ini === inicioSemana(ini)) { const k = Math.max(1, Math.ceil(L / SEM)); return [ini - k * SEM, fim - k * SEM]; }
    return [ini - L, ini];
  }

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
  function quantidade(nome, cat) {
    const n = semAcento(nome);
    if (cat === 'Criativos') { const m = n.match(/(\d+)\s+(novos\s+|novas\s+)?(ads|hooks|videos?-?reviews|ads de imagem)/); return m ? Number(m[1]) : 0; }
    if (cat === 'Leads') { const m = n.match(/(\d+)\s+nov[ao]s?\s+(variac[a-z]* de\s+)?(lead|microlead)/); return m ? Number(m[1]) : 0; }
    return 0;
  }

  const NICHO_PT = {
    lung: 'Pulmão', lungs: 'Pulmão', 'memory loss': 'Memória', memory: 'Memória', 'weight loss': 'Emagrecimento', skin: 'Pele',
    'male enhancement': 'Masculino', diabetes: 'Diabetes', vision: 'Visão', 'hair loss': 'Cabelo', 'joint pain': 'Articulações',
    'blood pressure': 'Pressão', hooks: 'Hooks', prostate: 'Próstata', tinnitus: 'Zumbido', neuropathy: 'Neuropatia', 'gut health': 'Intestino',
  };
  const nicho = (x) => (x ? NICHO_PT[semAcento(x)] || x : null);
  const nomeProduto = (p) => {
    const k = semAcento(p).replace(/\s+/g, '');
    const MAP = { sodapeak: 'SodaPeak', memohoney: 'MemoHoney', breathizen: 'BreathiZen', vapocept: 'VapoCept', sugarreset: 'Sugar Reset' };
    return MAP[k] || p;
  };
  const conta = (arr, chave) => {
    const m = new Map();
    arr.forEach((x) => [].concat(chave(x) || []).forEach((k) => { if (!k) return; const id = k.id || k; const r = m.get(id) || { nome: k.nome || k, url: k.url || null, n: 0, itens: [] }; r.n++; r.itens.push(x); m.set(id, r); }));
    return [...m.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
  };

  // ---------- cálculo para um período ----------
  // raw: dados do robô (versao 2) · ini/fim: período [ini, fim) em ms · agora: relógio
  function calcula(raw, { ini, fim, agora = Date.now() }) {
    const [cIni, cFim] = comparacao(ini, fim);
    const dentro = (ts, a, b) => ts != null && ts >= a && ts < b;

    // semanas do gráfico: até 8 semanas terminando na semana do fim do período (mais, se o período for maior)
    const sFim = inicioSemana(agora); // sempre até a semana atual (tempo real)
    const sIni = Math.min(inicioSemana(ini), sFim - 7 * SEM);
    const semanas = [];
    for (let s = sIni; s <= sFim; s += SEM) {
      semanas.push({ ini: s, fim: s + SEM, nome: nomeSemana(s, agora, true), datas: faixaDatas(s, s + SEM), parcial: s === inicioSemana(agora), sel: s + SEM > ini && s < fim });
    }
    const idxSem = (ts) => { const s = inicioSemana(ts); return semanas.findIndex((w) => w.ini === s); };

    // esteira
    const est = (raw.esteira || []).map((e) => ({ ...e, produto: e.produto ? nomeProduto(e.produto) : null, nichoPt: nicho(e.nicho) }));
    const estP = est.filter((e) => dentro(e.criado, ini, fim));
    const estC = est.filter((e) => dentro(e.criado, cIni, cFim));
    const porTipo = (arr) => ({ ads: arr.filter((e) => e.tipo === 'ads').length, lead: arr.filter((e) => e.tipo === 'lead').length, pote: arr.filter((e) => e.tipo === 'pote').length });
    const estSemanal = semanas.map((w) => ({ ...w, ads: 0, lead: 0, pote: 0 }));
    est.forEach((e) => { const i = idxSem(e.criado); if (i >= 0) estSemanal[i][e.tipo]++; });
    // corta semanas iniciais sem nenhum dado da esteira (antes de ela existir)
    let k0 = estSemanal.findIndex((w) => w.ads + w.lead + w.pote > 0); if (k0 < 0) k0 = 0; k0 = Math.min(k0, Math.max(0, estSemanal.length - 2));

    const afil = conta(estP, (e) => e.afiliados);
    const semAfiliado = estP.filter((e) => !(e.afiliados || []).length).length;
    const abertos = est.filter((e) => e.aberto).map((e) => ({ ...e, dias: Math.max(0, Math.floor((agora - e.criado) / DIA)) })).sort((a, b) => b.dias - a.dias || b.criado - a.criado);
    const produtos = conta(estP.filter((e) => e.tipo !== 'ads'), (e) => e.produto || 'Sem produto');
    const nichos = conta(estP.filter((e) => e.tipo === 'ads'), (e) => e.nichoPt || 'Sem nicho');

    // squads
    const sq = (raw.squads || []).map((t) => { const cat = categoria(t.nome); return { ...t, cat, qtd: quantidade(t.nome, cat) }; });
    const sqP = sq.filter((t) => dentro(t.fechado, ini, fim));
    const sqC = sq.filter((t) => dentro(t.fechado, cIni, cFim));
    const squads = SQUADS.map((s) => {
      const a = sqP.filter((t) => t.squad === s.id), b = sqC.filter((t) => t.squad === s.id);
      const mix = {}; a.forEach((t) => { mix[t.cat] = (mix[t.cat] || 0) + 1; });
      const semanal = semanas.map((w) => sq.filter((t) => t.squad === s.id && dentro(t.fechado, w.ini, w.fim)).length);
      return { ...s, url: (raw.listas || {})[s.id] || null, entregas: a.length, anterior: b.length, mix, semanal, itens: a };
    });
    const doTipo = (arr, cat) => arr.filter((t) => t.cat === cat && t.qtd > 0);
    const soma = (arr) => arr.reduce((s, t) => s + t.qtd, 0);
    const criSemanal = semanas.map((w) => soma(doTipo(sq.filter((t) => dentro(t.fechado, w.ini, w.fim)), 'Criativos')));

    // CX
    const cx = (raw.cx || []).filter((p) => !/exemplo/i.test(p.nome || ''));
    const criada = (p) => /demanda criada|criad/.test(p.status);
    const cxP = cx.filter((p) => dentro(p.criado, ini, fim));
    const cxC = cx.filter((p) => dentro(p.criado, cIni, cFim));
    const cxCriadas = cxP.filter(criada);
    const cxOut = {
      pedidos: cxP.length, criadas: cxCriadas.length, criadasAnt: cxC.filter(criada).length,
      canceladas: cxP.filter((p) => /cancel/.test(p.status)).length,
      emFila: cx.filter((p) => /analise|aprovad/.test(semAcento(p.status))),
      afiliados: new Set(cxP.map((p) => p.afiliado).filter(Boolean)).size,
      analistas: conta(cxP, (p) => p.solicitante || 'Sem nome na descrição'),
      tipos: conta(cxP, (p) => p.tipo),
      itens: cxP,
    };

    const kpis = [
      { id: 'criativos', rotulo: 'Criativos produzidos', valor: soma(doTipo(sqP, 'Criativos')), anterior: soma(doTipo(sqC, 'Criativos')), detalhe: 'anúncios, hooks e vídeos-review entregues pelos squads', itens: doTipo(sqP, 'Criativos') },
      { id: 'leads', rotulo: 'Leads e microleads novas', valor: soma(doTipo(sqP, 'Leads')), anterior: soma(doTipo(sqC, 'Leads')), detalhe: 'peças de lead entregues pelos squads', itens: doTipo(sqP, 'Leads') },
      { id: 'entregas', rotulo: 'Demandas concluídas', valor: sqP.length, anterior: sqC.length, detalhe: 'tasks mãe fechadas nos 5 squads', itens: sqP },
      { id: 'cx', rotulo: 'Pedidos da CX', valor: cxP.length, anterior: cxC.length, detalhe: `${cxCriadas.length} viraram task sozinhos · ${cxOut.afiliados} afiliados`, itens: cxP },
    ];

    return {
      periodo: { ini, fim, cIni, cFim },
      semanas,
      materiais: { valor: estP.length, anterior: estC.length, tipos: porTipo(estP), itens: estP, semanal: estSemanal.slice(k0), afiliados: afil, semAfiliado },
      kpis, squads, criSemanal, abertos, produtos, nichos, cx: cxOut,
    };
  }

  return { calcula, atalhos, comparacao, inicioSemana, inicioDia, inicioMes, nomeSemana, faixaDatas, partes, diaIni, categoria, quantidade, TIPO_NOME, SQUADS, DIA, SEM, FUSO, MESC };
});
