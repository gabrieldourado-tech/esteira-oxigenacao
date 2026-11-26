// Visual da planilha "Funnel Ops — Ocorrências" (mesmo tema escuro do painel Funnel Ops).
// Rode estilizarPlanilha() no editor. Pode rodar de novo quando quiser: refaz tudo do zero,
// sem mexer nos registros. A aba "Ocorrências" continua com Data e horário | Descrição | Responsável
// na linha 1, que é o que o painel lê e escreve.

const TEMA = {
  fundo: '#0B0F17', painel: '#121821', faixa1: '#141A23', faixa2: '#10151D', linha: '#232B36',
  texto: '#E6E9EE', suave: '#9AA3AF', apagado: '#6B7480', laranja: '#FF7A1A',
  pablo: '#3B82F6', pabloFundo: '#14233F', luis: '#A78BFA', luisFundo: '#251B40',
  fonte: 'Inter', mono: 'Roboto Mono',
};

function estilizarPlanilha() {
  const ss = planilha();
  ss.setSpreadsheetLocale('pt_BR');
  ss.setSpreadsheetTimeZone('America/Sao_Paulo');
  estilizarOcorrencias_(ss);
  montarPainel_(ss);
  ss.setActiveSheet(ss.getSheetByName('Painel'));
  ss.moveActiveSheet(1);
  SpreadsheetApp.flush();
}

/* ---------- aba Ocorrências: a base ---------- */
function estilizarOcorrencias_(ss) {
  const sh = ss.getSheetByName('Ocorrências') || ss.getSheets()[0];
  const T = TEMA;
  if (sh.getMaxRows() < 1000) sh.insertRowsAfter(sh.getMaxRows(), 1000 - sh.getMaxRows());
  if (sh.getMaxColumns() > 3) sh.deleteColumns(4, sh.getMaxColumns() - 3);
  const linhas = sh.getMaxRows();
  sh.getBandings().forEach((b) => b.remove());
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clearConditionalFormatRules();

  const tudo = sh.getRange(1, 1, linhas, 3);
  tudo.setFontFamily(T.fonte).setFontSize(10).setFontColor(T.texto).setBackground(T.faixa1)
    .setVerticalAlignment('middle').setBorder(false, false, false, false, false, false);

  // cabeçalho
  const cab = sh.getRange(1, 1, 1, 3);
  cab.setValues([['DATA E HORÁRIO', 'DESCRIÇÃO DA OCORRÊNCIA', 'RESPONSÁVEL']])
    .setBackground(T.fundo).setFontColor(T.laranja).setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle')
    .setBorder(null, null, true, null, null, null, T.laranja, SpreadsheetApp.BorderStyle.SOLID_THICK);
  sh.getRange('A1').setHorizontalAlignment('left');
  sh.getRange('C1').setHorizontalAlignment('center');
  sh.setRowHeight(1, 42);
  sh.setFrozenRows(1);

  // corpo
  sh.getRange(2, 1, linhas - 1, 1).setNumberFormat('dd/MM/yyyy  HH:mm').setFontFamily(T.mono)
    .setFontColor(T.suave).setHorizontalAlignment('left');
  sh.getRange(2, 2, linhas - 1, 1).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(2, 3, linhas - 1, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.setRowHeightsForced(2, linhas - 1, 34);
  sh.setColumnWidth(1, 165); sh.setColumnWidth(2, 640); sh.setColumnWidth(3, 140);

  // faixas alternadas (valem para as linhas novas que o painel adicionar)
  const banda = tudo.applyRowBanding(SpreadsheetApp.BandingTheme.GREY, true, false);
  banda.setHeaderRowColor(T.fundo).setFirstRowColor(T.faixa1).setSecondRowColor(T.faixa2);

  // responsável em "etiqueta" colorida + lista suspensa
  const resp = sh.getRange(2, 3, linhas - 1, 1);
  resp.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pablo', 'Luis'], true)
    .setAllowInvalid(false).setHelpText('Escolha Pablo ou Luis').build());
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Pablo').setBackground(T.pabloFundo).setFontColor(T.pablo).setRanges([resp]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Luis').setBackground(T.luisFundo).setFontColor(T.luis).setRanges([resp]).build(),
  ]);

  sh.getRange(1, 1, linhas, 3).createFilter();
  sh.setHiddenGridlines(true);
  sh.setTabColor(T.laranja);
}

/* ---------- aba Painel: resumo que se atualiza sozinho ---------- */
function montarPainel_(ss) {
  const T = TEMA;
  let sh = ss.getSheetByName('Painel');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Painel', 0);
  sh.getCharts().forEach((c) => sh.removeChart(c));
  if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(), 14 - sh.getMaxColumns());
  if (sh.getMaxColumns() > 14) sh.deleteColumns(15, sh.getMaxColumns() - 14);
  if (sh.getMaxRows() > 70) sh.deleteRows(71, sh.getMaxRows() - 70);
  const tudo = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  tudo.setBackground(T.fundo).setFontFamily(T.fonte).setFontColor(T.texto).setFontSize(10).setVerticalAlignment('middle');
  sh.setHiddenGridlines(true);
  sh.setTabColor(T.laranja);

  // grade: A e N são margens; B..M = 12 colunas de 92 px
  sh.setColumnWidth(1, 28); sh.setColumnWidth(14, 28);
  for (let c = 2; c <= 13; c++) sh.setColumnWidth(c, 92);
  const O = "'Ocorrências'!";

  // título
  sh.setRowHeight(1, 18);
  sh.getRange('B2:M2').merge().setValue('FUNNEL OPS — OCORRÊNCIAS').setFontSize(22).setFontWeight('bold').setFontColor(T.texto);
  sh.setRowHeight(2, 44);
  sh.getRange('B3:M3').merge()
    .setFormula(pt_('="Histórico de ocorrências do time de Infra · atualizado em "&TEXT(NOW();"dd/mm/yyyy hh:mm")'))
    .setFontColor(T.suave).setFontSize(10);
  sh.getRange('B4:M4').setBorder(null, null, true, null, null, null, T.laranja, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(4, 8); sh.setRowHeight(5, 16);

  // cards (4 cards de 3 colunas)
  const cards = [
    ['B', 'D', 'TOTAL', `=COUNTA(${O}B2:B)`, '0', T.laranja, 'ocorrências registradas'],
    ['E', 'G', 'PABLO', `=COUNTIF(${O}C2:C,"Pablo")`, '0', T.pablo, `=IFERROR(TEXT(COUNTIF(${O}C2:C,"Pablo")/COUNTA(${O}B2:B),"0%")&" do total","—")`],
    ['H', 'J', 'LUIS', `=COUNTIF(${O}C2:C,"Luis")`, '0', T.luis, `=IFERROR(TEXT(COUNTIF(${O}C2:C,"Luis")/COUNTA(${O}B2:B),"0%")&" do total","—")`],
    ['K', 'M', 'ÚLTIMOS 7 DIAS', `=COUNTIFS(${O}A2:A,">="&(NOW()-7))`, '0', T.texto, `=IFERROR("última em "&TEXT(MAX(${O}A2:A),"dd/mm hh:mm"),"—")`],
  ];
  sh.setRowHeight(6, 26); sh.setRowHeight(7, 52); sh.setRowHeight(8, 24); sh.setRowHeight(9, 18);
  cards.forEach(([c1, c2, rotulo, valor, fmt, cor, rodape]) => {
    const bloco = sh.getRange(`${c1}6:${c2}8`);
    bloco.setBackground(T.painel).setBorder(true, true, true, true, false, false, T.linha, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(`${c1}6:${c2}6`).merge().setValue('  ' + rotulo).setFontSize(9).setFontWeight('bold').setFontColor(T.suave).setVerticalAlignment('bottom');
    sh.getRange(`${c1}7:${c2}7`).merge().setFormula(pt_(valor)).setNumberFormat(fmt).setFontSize(30).setFontWeight('bold').setFontColor(cor).setHorizontalAlignment('left');
    sh.getRange(`${c1}7:${c2}7`).setHorizontalAlignment('left');
    const r = sh.getRange(`${c1}8:${c2}8`).merge().setFontSize(9).setFontColor(T.apagado).setVerticalAlignment('top');
    if (String(rodape).charAt(0) === '=') r.setFormula(pt_(rodape)); else r.setValue('  ' + rodape);
    sh.getRange(`${c1}6:${c1}8`).setBorder(null, true, null, null, null, null, cor, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  // recuo do número grande (espaço à esquerda)
  ['B7', 'E7', 'H7', 'K7'].forEach((a) => {
    const c = sh.getRange(a); c.setFormula(pt_('=" "&TEXT(' + c.getFormula().slice(1) + ',"0")'));
  });

  // seção: por mês
  secao_(sh, 'B10:G10', 'POR MÊS');
  sh.getRange('B11:G11').setValues([['MÊS', '', 'PABLO', 'LUIS', 'TOTAL', '']])
    .setFontSize(9).setFontWeight('bold').setFontColor(T.suave).setBackground(T.painel);
  sh.getRange('B11:C11').merge();
  sh.getRange('B12').setFormula(pt_(`=IFERROR(SORT(UNIQUE(FILTER(DATE(YEAR(${O}A2:A),MONTH(${O}A2:A),1),${O}A2:A<>"")),1,FALSE),"")`));
  sh.getRange('D12').setFormula(pt_(`=ARRAYFORMULA(IF(B12:B23="",,COUNTIFS(${O}C2:C,"Pablo",${O}A2:A,">="&B12:B23,${O}A2:A,"<"&EDATE(B12:B23,1))))`));
  sh.getRange('E12').setFormula(pt_(`=ARRAYFORMULA(IF(B12:B23="",,COUNTIFS(${O}C2:C,"Luis",${O}A2:A,">="&B12:B23,${O}A2:A,"<"&EDATE(B12:B23,1))))`));
  sh.getRange('F12').setFormula(pt_('=ARRAYFORMULA(IF(B12:B23="",,D12:D23+E12:E23))'));
  const mes = sh.getRange('B12:G23');
  mes.setBackground(T.painel).setFontSize(10);
  sh.getRange('B12:B23').setNumberFormat('mmm "de" yyyy').setFontWeight('bold');
  sh.getRange('D12:D23').setFontColor(T.pablo).setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('E12:E23').setFontColor(T.luis).setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('F12:F23').setFontColor(T.laranja).setFontWeight('bold').setHorizontalAlignment('left');
  for (let r = 11; r <= 23; r++) sh.getRange(`B${r}:G${r}`).setBorder(null, null, true, null, null, null, T.linha, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeights(11, 13, 24);

  // seção: últimas ocorrências
  secao_(sh, 'H10:M10', 'ÚLTIMAS 8 OCORRÊNCIAS');
  sh.getRange('H11:M11').setValues([['QUANDO', '', 'QUEM', 'O QUE ACONTECEU', '', '']])
    .setFontSize(9).setFontWeight('bold').setFontColor(T.suave).setBackground(T.painel);
  sh.getRange('H11:I11').merge(); sh.getRange('K11:M11').merge();
  sh.getRange('H12').setFormula(pt_(`=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(${O}A2:A,${O}A2:A<>""),1,FALSE),8,1),"Nenhuma ocorrência ainda")`));
  sh.getRange('K12').setFormula(pt_(`=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(${O}B2:B,${O}A2:A<>""),FILTER(${O}A2:A,${O}A2:A<>""),FALSE),8,1),"")`));
  sh.getRange('J12').setFormula(pt_(`=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(${O}C2:C,${O}A2:A<>""),FILTER(${O}A2:A,${O}A2:A<>""),FALSE),8,1),"")`));
  const ult = sh.getRange('H12:M19');
  ult.setBackground(T.painel);
  for (let r = 12; r <= 19; r++) {
    sh.getRange(`H${r}:I${r}`).merge(); sh.getRange(`K${r}:M${r}`).merge();
    sh.getRange(`H${r}:M${r}`).setBorder(null, null, true, null, null, null, T.linha, SpreadsheetApp.BorderStyle.SOLID);
  }
  sh.getRange('H12:H19').setNumberFormat('dd/mm  hh:mm').setFontFamily(T.mono).setFontColor(T.suave);
  sh.getRange('J12:J19').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('K12:K19').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setFontColor(T.texto);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Pablo').setFontColor(T.pablo).setBackground(T.pabloFundo).setRanges([sh.getRange('J12:J19')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Luis').setFontColor(T.luis).setBackground(T.luisFundo).setRanges([sh.getRange('J12:J19')]).build(),
  ]);

  // gráfico: ocorrências por mês e responsável
  secao_(sh, 'B25:M25', 'EVOLUÇÃO POR MÊS');
  const graf = sh.newChart().asColumnChart()
    .addRange(sh.getRange('B11:B23')).addRange(sh.getRange('D11:E23'))
    .setStacked().setPosition(26, 2, 4, 6)
    .setOption('width', 1090).setOption('height', 300)
    .setOption('backgroundColor', { fill: T.painel })
    .setOption('chartArea', { backgroundColor: T.painel, left: 50, top: 30, width: '88%', height: '72%' })
    .setOption('colors', [T.pablo, T.luis])
    .setOption('legend', { position: 'top', textStyle: { color: T.texto, fontName: T.fonte, fontSize: 11 } })
    .setOption('hAxis', { textStyle: { color: T.suave, fontName: T.fonte }, gridlines: { color: 'transparent' }, format: 'MMM yyyy', direction: -1 })
    .setOption('vAxis', { textStyle: { color: T.suave, fontName: T.fonte }, gridlines: { color: T.linha }, baselineColor: T.linha, minValue: 0, format: '0' })
    .setOption('bar', { groupWidth: '45%' })
    .setOption('useFirstColumnAsDomain', true)
    .setNumHeaders(1)
    .build();
  sh.insertChart(graf);

  sh.setFrozenRows(0);
  sh.getRange('A1').activate();
}

// A planilha está em português (Brasil): nas fórmulas o separador é ponto e vírgula.
function pt_(f) {
  let out = '', aspas = false;
  for (const ch of f) { if (ch === '"') aspas = !aspas; out += (!aspas && ch === ',') ? ';' : ch; }
  return out;
}

function secao_(sh, a1, texto) {
  const r = sh.getRange(a1);
  r.merge().setValue(texto).setFontSize(10).setFontWeight('bold').setFontColor(TEMA.laranja)
    .setBackground(TEMA.fundo).setVerticalAlignment('bottom');
  sh.setRowHeight(r.getRow(), 30);
}
