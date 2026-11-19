// Funnel Ops ao vivo: o robô fica ligado e atualiza os dados de 1 em 1 minuto.
// Cada rodada busca só as tasks alteradas no ClickUp (a cada 15 min faz uma busca completa)
// e publica o resultado no branch "dados", que o painel lê direto (sem esperar o GitHub Pages).
const { execSync } = require('child_process');
const { rodada } = require('./sync-infra.js');

const MIN = 60e3;
const DURACAO = Number(process.env.DURACAO_MIN || 340) * MIN; // ~5h40; o GitHub encerra jobs em 6h, aí o robô se religa
const FULL_CADA = 15 * MIN;
const OUT = process.env.INFRA_OUT;
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const horaFortaleza = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Fortaleza', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const noHorario = () => horaFortaleza() >= 6; // liga das 6h à meia-noite (horário de Fortaleza)

function publica() {
  const blob = sh(`git hash-object -w ${OUT}`);
  const tree = sh(`printf '100644 blob ${blob}\\tinfra-data.json\\n' | git mktree`);
  const commit = sh(`git -c user.name=esteira-bot -c user.email=esteira-bot@users.noreply.github.com commit-tree ${tree} -m "Funnel Ops ao vivo"`);
  sh(`git push -q -f origin ${commit}:refs/heads/dados`);
}

(async () => {
  if (!OUT) throw new Error('Falta INFRA_OUT');
  const inicio = Date.now(); const estado = {};
  let ultimaFull = 0, ultimaBusca = 0, falhas = 0, rodadas = 0, ultimoPush = 0;
  while (Date.now() - inicio < DURACAO && noHorario()) {
    const t = Date.now();
    try {
      const full = !estado.brutas || t - ultimaFull > FULL_CADA;
      const r = await rodada(estado, { incremental: !full, desde: ultimaBusca - 2 * MIN, aoVivo: true });
      ultimaBusca = r.inicio; if (full) ultimaFull = t;
      // publica quando algo mudou, na busca completa, ou a cada 5 min (para o painel saber que o robô está vivo)
      if (r.alteradas > 0 || full || Date.now() - ultimoPush > 5 * MIN) { publica(); ultimoPush = Date.now(); console.log('Publicado.'); }
      falhas = 0; rodadas++;
    } catch (e) {
      console.log('Falha na rodada:', e.message);
      if (++falhas >= 5) throw e;
    }
    const espera = MIN - (Date.now() - t);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  }
  console.log(`Fim do turno do robô ao vivo: ${rodadas} rodadas.`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
