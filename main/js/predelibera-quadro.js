(function (root) {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
  const unique = values => [...new Set(values.filter(Boolean))];
  const money = value => typeof value === "number"
    ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value) : "N/D";
  const percent = value => typeof value === "number"
    ? new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + "%" : "N/D";

  function render({ report: r = {}, summary: s = {}, stale = false, decision = "", requests = [] }) {
    const m = r.mergedFinancials || {};
    const income = s.riepilogo?.reddito || {};
    const bank = m.alertBancari || {};
    const anomalies = r.anomalies || s.anomalie || {};
    const technicalReasons = r.reviewFlags?.motiviReview || s.review?.motiviReview || [];
    const actionList = unique([
      ...(anomalies.anomalieBloccanti || []),
      ...(anomalies.anomalieWarning || []),
      ...(r.contractVerification || []).map(check => check.reason),
      ...(technicalReasons.filter(reason => /reddito da verificare|rata del nuovo mutuo|rapporto .*non calcolabile/i.test(reason))),
    ]);
    const states = {
      inviata: "Richiesta inviata al cliente",
      invio_in_corso: "Invio in corso",
      invio_non_riuscito: "Slot aperto, email da reinviare",
      email_mancante: "Slot aperto, email cliente mancante",
      slot_esistente: "Slot già presente nel portale",
    };
    const coverage = unique(r.bankCoverageWarnings || []);
    const movements = unique(bank.entrateStraordinarie || []);
    const bankAlerts = unique([
      ...(bank.scommesse || []), ...(bank.contanti || []), ...(bank.rate || []),
      ...(bank.riscossione || []), ...(bank.crypto || []),
      bank.saldoNegativoOScoperti ? "Saldo negativo, scoperto o insoluto rilevato." : "",
    ]);
    const flags = unique([...movements, ...bankAlerts]);
    const blocking = (anomalies.anomalieBloccanti || []).length;
    const review = blocking || s.severity === "warning" || s.severity === "error" || decision === "PRACTICE_REVIEW";
    const actionCount = actionList.length + coverage.length + flags.length;
    const accounts = Object.entries(m.redditiPerRichiedente || income.redditiPerRichiedente || {});
    const advice = (r.bankMatch?.consigliate || []).map(item => typeof item === "string" ? item : item.nome || item.banca);
    const metrics = [
      ["Rata / reddito", percent(m.dti ?? income.dti)],
      ["Rata mensile", money(s.riepilogo?.operazione?.rataMutuoStimata)],
      ["Reddito mensile", money(m.redditoBancarioMensile ?? income.redditoBancarioMensile)],
      ["Mutuo / valore", percent(m.ltv ?? income.ltv)],
    ];
    const list = items => '<ul>' + items.map(item => '<li>' + escape(item) + '</li>').join("") + '</ul>';
    const requestsList = requests.map(item => states[item.state]).filter(Boolean);
    const pendingNote = review ? "Vedi i motivi nel report completo." : "Nessuna azione prioritaria.";
    return `<div class="pd-board">
      ${stale ? '<p class="pd-stale" role="status">Aggiornamento non riuscito. Ultimo report salvato.</p>' : ""}
      <header class="pd-hero">
        <div><small>Pre-delibera</small><h3>${escape(s.esito || "Esito non disponibile")}</h3></div>
        <span class="pd-status ${review ? "pd-status-review" : ""}">${blocking ? "Anomalie bloccanti" : actionCount ? "Verifiche aperte" : review ? "Revisione aperta" : "Riepilogo"}</span>
      </header>
      <section class="pd-metrics" aria-label="Indicatori">${metrics.map(([label, value]) =>
        `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join("")}</section>
      <section class="pd-panel pd-priority ${actionList.length ? "pd-danger" : ""}">
        <h4>Da verificare</h4>
        ${actionList.length ? list(actionList) : `<p>${pendingNote}</p>`}
        ${requestsList.length ? `<p class="pd-note">${escape(unique(requestsList).join(" · "))}</p>` : ""}
      </section>
      <section class="pd-panel pd-coverage ${coverage.length ? "pd-danger" : ""}">
        <h4>Copertura bancaria</h4>
        ${coverage.length ? list(coverage) : `<p>${m.bankDataAvailable ? "Nessuna interruzione segnalata per i periodi analizzati." : "Nessun estratto o lista movimenti analizzata."}</p>`}
      </section>
      <section class="pd-panel pd-income">
        <h4>Reddito per richiedente</h4>
        ${accounts.length ? `<table><thead><tr><th>Richiedente</th><th>Fonte</th><th>Netto mensile</th></tr></thead><tbody>${accounts.map(([key, row]) =>
          `<tr><td>${escape(key.toUpperCase())}</td><td>${escape(row.fonte || "N/D")}${row.nonVerificato ? " · da verificare" : ""}</td><td>${escape(money(row.redditoNettoMensile))}</td></tr>`).join("")}</tbody></table>` : '<p>Dettaglio non disponibile.</p>'}
      </section>
      <section class="pd-panel pd-bank ${flags.length ? "pd-danger" : ""}">
        <h4>Movimenti da verificare</h4>
        ${movements.length ? `<p class="pd-label">Entrate straordinarie</p>${list(movements)}` : ""}
        ${bankAlerts.length ? list(bankAlerts) : ""}
        ${flags.length ? "" : "<p>Nessuna movimentazione segnalata.</p>"}
      </section>
      <details class="pd-panel pd-detail"><summary>Report completo</summary>
        ${decision ? `<p class="pd-note">Codice esito · ${escape(decision)}</p>` : ""}
        ${typeof m.scoreIncome === "number" || typeof m.scoreBank === "number" ? `<p class="pd-note">Score reddito · ${escape(m.scoreIncome ?? "N/D")} · Score bancario · ${escape(m.scoreBank ?? "N/D")}</p>` : ""}
        ${advice.length ? `<h4>Banche e policy potenzialmente compatibili</h4>${list(advice)}` : ""}
        <pre>${escape(s.reportTestuale || "Report testuale non disponibile.")}</pre>
      </details>
    </div>`;
  }

  root.CredipassPredelibera = { render };
  if (typeof module === "object") module.exports = root.CredipassPredelibera;
})(globalThis);
