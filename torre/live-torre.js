// Torre de Controle ao vivo: o robô fica ligado e relê o ClickUp a cada minuto.
// Cada rodada busca só o que mudou (a cada 15 min faz uma busca completa) e publica
// torre-data.json no branch "dados-torre", que o painel lê direto (sem esperar o GitHub Pages).
const fs = require('fs');
const { execSync } = require('child_process');
const { rodada } = require('./sync-torre.js');

const MIN = 60e3;
const DURACAO = Number(process.env.DURACAO_MIN || 340) * MIN; // o GitHub encerra jobs em 6h; o robô se religa
const FULL_CADA = 15 * MIN;
const OUT = process.env.TORRE_OUT || '/tmp/torre-data.json';
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const horaFortaleza = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Fortaleza', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const noHorario = () => horaFortaleza() >= 6; // das 6h à meia-noite (Fortaleza)

function publica() {
  const blob = sh(`git hash-object -w ${OUT}`);
  const tree = sh(`printf '100644 blob ${blob}\\ttorre-data.json\\n' | git mktree`);
  const commit = sh(`git -c user.name=esteira-bot -c user.email=esteira-bot@users.noreply.github.com commit-tree ${tree} -m "Torre ao vivo"`);
  sh(`git push -q -f origin ${commit}:refs/heads/dados-torre`);
}

(async () => {
  if (!process.env.CLICKUP_TOKEN) throw new Error('Falta CLICKUP_TOKEN');
  const inicio = Date.now(); const estado = {};
  let ultimaFull = 0, ultimaBusca = 0, falhas = 0, rodadas = 0, ultimoPush = 0;
  do {
    const t = Date.now();
    try {
      const full = !estado.esteira || t - ultimaFull > FULL_CADA;
      const r = await rodada(estado, { incremental: !full, desde: ultimaBusca - 2 * MIN });
      ultimaBusca = r.inicio; if (full) ultimaFull = t;
      fs.writeFileSync(OUT, JSON.stringify(r.dados));
      // publica quando algo mudou, na busca completa, ou a cada 2 min (para o painel saber que o robô está vivo)
      if (r.alteradas > 0 || full || Date.now() - ultimoPush > 2 * MIN) { publica(); ultimoPush = Date.now(); console.log('Publicado.'); }
      falhas = 0; rodadas++;
    } catch (e) {
      console.log('Falha na rodada:', e.message);
      if (++falhas >= 5) throw e;
    }
    const espera = MIN - (Date.now() - t);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  } while (Date.now() - inicio < DURACAO && noHorario());
  console.log(`Fim do turno do robô da Torre: ${rodadas} rodadas.`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
