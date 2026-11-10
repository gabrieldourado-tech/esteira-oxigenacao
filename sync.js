// Puxa do ClickUp as tasks da Esteira de Oxigenação e grava data.json para o painel.
// Roda no GitHub Actions. Precisa do segredo CLICKUP_TOKEN no repositório.
const fs = require('fs');

const TOKEN = process.env.CLICKUP_TOKEN;
const TEAM = '3076960';          // workspace Grupo Experience
const SPACE = '90133029526';     // espaço Afiliados
const TAG = 'oxigenacao';

if (!TOKEN) { console.error('Falta o segredo CLICKUP_TOKEN.'); process.exit(1); }

async function api(path) {
  const r = await fetch('https://api.clickup.com/api/v2' + path, { headers: { Authorization: TOKEN } });
  if (!r.ok) throw new Error(`ClickUp ${r.status} em ${path}: ${await r.text()}`);
  return r.json();
}

const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
const limpa = (s) => String(s || '').replace(/^[^\p{L}\p{N}\[]+/u, '').trim();
const nomes = (a) => (a || []).map((x) => String(x.username || '').trim()).filter(Boolean).join(', ') || null;
const campo = (cfs, nome) => {
  const f = (cfs || []).find((c) => String(c.name || '').includes(nome));
  if (!f || f.value == null || f.value === '') return null;
  const t = f.type_config || {};
  if (f.type === 'drop_down' && Array.isArray(t.options)) {
    const o = t.options.find((o) => o.id === f.value || o.orderindex === f.value);
    return o ? o.name : null;
  }
  if (Array.isArray(f.value)) return f.value.map((v) => v.label || v.name || v).join(', ');
  if (typeof f.value === 'object') return f.value.name || f.value.label || null;
  return String(f.value);
};

(async () => {
  const maes = [];
  for (let page = 0; page < 20; page++) {
    const q = `?tags[]=${TAG}&space_ids[]=${SPACE}&include_closed=true&subtasks=false&page=${page}`;
    const res = await api(`/team/${TEAM}/task${q}`);
    maes.push(...(res.tasks || []).filter((t) => !t.parent));
    if (res.last_page !== false || !(res.tasks || []).length) break;
  }

  if (!maes.length) {
    console.log('Nenhuma task com a tag ainda. Mantendo os dados de exemplo.');
    return;
  }

  const rows = [];
  for (const m of maes) {
    const t = await api(`/task/${m.id}?include_subtasks=true`);
    const base = {
      oferta_id: t.id, oferta_url: t.url, oferta_nome: limpa(t.name),
      produto: campo(t.custom_fields, 'Produto'), nicho: campo(t.custom_fields, 'Nicho'),
      squad: t.folder && t.folder.name ? t.folder.name : null,
      oferta_status: t.status && t.status.status, tags: (t.tags || []).map((x) => x.name).join(','),
      criado_em: iso(t.date_created),
    };
    const subs = (t.subtasks || []).slice().sort((a, b) => Number(a.date_created) - Number(b.date_created));
    if (!subs.length) rows.push({ ...base, etapa_ordem: null, etapa: null, etapa_status: null, responsavel: null, etapa_atualizada_em: null, etapa_prazo: null });
    subs.forEach((s, i) => rows.push({
      ...base, etapa_ordem: i + 1, etapa: limpa(s.name), etapa_status: s.status && (s.status.status || s.status),
      responsavel: nomes(s.assignees), etapa_atualizada_em: iso(s.date_done || s.date_closed || s.date_updated), etapa_prazo: iso(s.due_date),
    }));
  }

  fs.writeFileSync('data.json', JSON.stringify({ gerado_em: new Date().toISOString(), modo: 'real', rows }));
  console.log(`data.json gravado: ${maes.length} ofertas, ${rows.length} etapas.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
