// Funnel Ops — web app do Google Apps Script usado pelo painel.
//  1) Botão ↻ Sincronizar: lê no ClickUp, na hora, as tasks do Malvas, Pablo e Luis que mudaram
//     nos últimos minutos. Só leitura.
//  2) Aba Ocorrências: registra e lista ocorrências na planilha "Funnel Ops — Ocorrências".
//
// Propriedades do script (Configurações do projeto → Propriedades do script):
//   CLICKUP_TOKEN    token da API do ClickUp
//   OCORRENCIAS_PIN  código de acesso da aba Ocorrências (quem não tem o código não vê nem registra)
//   OCORRENCIAS_SHEET_ID  criado sozinho na primeira vez (rode criarPlanilha no editor)

const TEAM = '3076960';
const PESSOAS = ['112049379', '118125018', '118123716']; // Malvas, Pablo, Luis
const MAX_JANELA_MS = 3 * 60 * 60 * 1000; // no máximo 3 h para trás
const RESPONSAVEIS = ['Pablo', 'Luis'];
const PROPS = PropertiesService.getScriptProperties();

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    return sincronizar(p);
  } catch (err) {
    return json({ ok: false, erro: String(err.message || err).slice(0, 300) });
  }
}

function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.acao === 'registrar') return registrarOcorrencia(b);
    if (b.acao === 'listar') return listarOcorrencias(b.pin);
    return json({ ok: false, erro: 'Ação desconhecida.' });
  } catch (err) {
    return json({ ok: false, erro: String(err.message || err).slice(0, 300) });
  }
}

/* ---------------- 1) Sincronizar agora ---------------- */
function sincronizar(p) {
  const agora = Date.now();
  let desde = Number(p.desde || 0);
  if (!desde || desde < agora - MAX_JANELA_MS) desde = agora - MAX_JANELA_MS;
  const token = PROPS.getProperty('CLICKUP_TOKEN');
  if (!token) return json({ ok: false, erro: 'Falta a propriedade CLICKUP_TOKEN no script.' });
  const quem = PESSOAS.map((id) => 'assignees[]=' + id).join('&');
  const base = '/team/' + TEAM + '/task?include_closed=true&subtasks=true&order_by=updated&date_updated_gt=' + Math.floor(desde);
  const infra = paginas(token, base + '&' + quem, 3);
  const geral = paginas(token, base, 2); // subtasks de edição que mudaram (liberam a infra)
  const ED = /edi[cç][aã]o|editar v[ií]deo/i;
  const edicoes = geral.filter((t) => t.parent && ED.test(t.name || '')).map((t) => ({
    id: t.id, parent: t.parent, status: st(t), feita: feita(t), cancelada: /cancel/i.test(st(t)), fim: fim(t),
  }));
  const tasks = infra.map((t) => ({
    id: t.id, nome: t.name, parent: t.parent || null,
    status: st(t), status_tipo: (t.status && t.status.type) || '',
    feita: feita(t), cancelada: /cancel|n[aã]o feito/i.test(st(t)), fim: fim(t),
    prazo: num(t.due_date), criado: num(t.date_created), atualizado: num(t.date_updated),
    assignees: (t.assignees || []).map((a) => a.id).filter((id) => PESSOAS.indexOf(String(id)) >= 0),
    lista: t.list && t.list.name,
  }));
  return json({ ok: true, agora: agora, desde: desde, tasks: tasks, edicoes: edicoes });
}

function paginas(token, caminho, max) {
  const out = [];
  for (let p = 0; p < max; p++) {
    const r = UrlFetchApp.fetch('https://api.clickup.com/api/v2' + caminho + '&page=' + p, {
      headers: { Authorization: token }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) throw new Error('ClickUp ' + r.getResponseCode());
    const j = JSON.parse(r.getContentText());
    (j.tasks || []).forEach((t) => out.push(t));
    if (j.last_page !== false || !(j.tasks || []).length) break;
  }
  return out;
}

/* ---------------- 2) Ocorrências ---------------- */
function confere(pin) {
  const certo = PROPS.getProperty('OCORRENCIAS_PIN');
  if (!certo) throw new Error('O código de acesso ainda não foi definido (propriedade OCORRENCIAS_PIN).');
  if (String(pin || '').trim() !== String(certo).trim()) throw new Error('Código de acesso incorreto.');
}

// Rode esta função uma vez no editor (botão Executar) para criar a planilha e autorizar o acesso.
function criarPlanilha() {
  const ss = planilha();
  Logger.log('Planilha: ' + ss.getUrl());
}

function planilha() {
  const id = PROPS.getProperty('OCORRENCIAS_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('Funnel Ops — Ocorrências');
  ss.setSpreadsheetTimeZone('America/Sao_Paulo');
  const sh = ss.getSheets()[0];
  sh.setName('Ocorrências');
  sh.getRange(1, 1, 1, 3).setValues([['Data e horário', 'Descrição', 'Responsável']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 520); sh.setColumnWidth(3, 120);
  sh.getRange('B:B').setWrap(true);
  PROPS.setProperty('OCORRENCIAS_SHEET_ID', ss.getId());
  return ss;
}

function aba() { const ss = planilha(); return { ss: ss, sh: ss.getSheetByName('Ocorrências') || ss.getSheets()[0] }; }

function registrarOcorrencia(b) {
  confere(b.pin);
  const responsavel = String(b.responsavel || '');
  if (RESPONSAVEIS.indexOf(responsavel) < 0) return json({ ok: false, erro: 'Escolha o responsável: Pablo ou Luis.' });
  let descricao = String(b.descricao || '').trim().slice(0, 5000);
  if (!descricao) return json({ ok: false, erro: 'Descreva a ocorrência.' });
  if (/^[=+\-@]/.test(descricao)) descricao = "'" + descricao; // não deixa virar fórmula na planilha
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const agora = new Date();
    aba().sh.appendRow([agora, descricao, responsavel]);
    return json({ ok: true, registro: { em: agora.getTime(), descricao: descricao.replace(/^'/, ''), responsavel: responsavel } });
  } finally { lock.releaseLock(); }
}

function listarOcorrencias(pin) {
  confere(pin);
  const a = aba();
  const ult = a.sh.getLastRow();
  const vals = ult > 1 ? a.sh.getRange(2, 1, ult - 1, 3).getValues() : [];
  const itens = vals.filter((r) => r[1] !== '').map((r) => ({
    em: r[0] instanceof Date ? r[0].getTime() : null, descricao: String(r[1]), responsavel: String(r[2]),
  })).reverse();
  return json({ ok: true, url: a.ss.getUrl(), itens: itens });
}

/* ---------------- utilidades ---------------- */
const num = (v) => (v == null || v === '' ? null : Number(v));
const st = (t) => String((t.status && t.status.status) || '').toLowerCase();
const fechada = (t) => ['closed', 'done'].indexOf((t.status && t.status.type) || '') >= 0 || !!t.date_done || !!t.date_closed;
const feita = (t) => /^(feito|conclu[ií]do|complete|done)$/i.test(st(t).trim()) || (t.status && t.status.type) === 'closed';
const fim = (t) => num(t.date_done) || num(t.date_closed) || (fechada(t) ? num(t.date_updated) : null);
const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
