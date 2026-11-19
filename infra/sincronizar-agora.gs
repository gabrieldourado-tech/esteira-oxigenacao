// Funnel Ops — "Sincronizar agora"
// Web app do Google Apps Script que o botão ↻ Sincronizar do painel chama.
// Lê no ClickUp, na hora, as tasks do Malvas, Pablo e Luis que mudaram nos últimos minutos
// e devolve só os campos que o painel precisa. O token fica nas Propriedades do script
// (CLICKUP_TOKEN), nunca no código nem na página.
//
// Só leitura: não cria, não altera e não apaga nada no ClickUp.

const TEAM = '3076960';
const PESSOAS = ['112049379', '118125018', '118123716']; // Malvas, Pablo, Luis
const MAX_JANELA_MS = 3 * 60 * 60 * 1000; // no máximo 3 h para trás

function doGet(e) {
  const agora = Date.now();
  let desde = Number((e && e.parameter && e.parameter.desde) || 0);
  if (!desde || desde < agora - MAX_JANELA_MS) desde = agora - MAX_JANELA_MS;
  try {
    const token = PropertiesService.getScriptProperties().getProperty('CLICKUP_TOKEN');
    if (!token) return json({ ok: false, erro: 'Falta a propriedade CLICKUP_TOKEN no script.' });
    const quem = PESSOAS.map((id) => 'assignees[]=' + id).join('&');
    const base = '/team/' + TEAM + '/task?include_closed=true&subtasks=true&order_by=updated&date_updated_gt=' + Math.floor(desde);
    const infra = paginas(token, base + '&' + quem, 3);
    // subtasks de edição que mudaram (liberam a infra para a fila)
    const geral = paginas(token, base, 2);
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
  } catch (err) {
    return json({ ok: false, erro: String(err).slice(0, 300) });
  }
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

const num = (v) => (v == null || v === '' ? null : Number(v));
const st = (t) => String((t.status && t.status.status) || '').toLowerCase();
const fechada = (t) => ['closed', 'done'].indexOf((t.status && t.status.type) || '') >= 0 || !!t.date_done || !!t.date_closed;
const feita = (t) => /^(feito|conclu[ií]do|complete|done)$/i.test(st(t).trim()) || (t.status && t.status.type) === 'closed';
const fim = (t) => num(t.date_done) || num(t.date_closed) || (fechada(t) ? num(t.date_updated) : null);
const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
