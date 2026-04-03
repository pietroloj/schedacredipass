function buildUiResult({ severity, titolo, messaggio, badge = [] }) {
  return { severity, titolo, messaggio, badge };
}

function buildBaseResponse({
  ok,
  stato,
  tipoDocumentoAtteso,
  tipoDocumentoRilevato = "",
  confidence = 0,
  valido = false,
  reviewManuale = false,
  motiviReview = [],
  decisionCode = "",
  analysisKey = "",
  pipelineVersion = "",
  classificazione = null,
  estrazione = null,
  decisioneBackend = null,
  ui = null,
}) {
  return {
    ok,
    stato,
    tipoDocumentoAtteso,
    tipoDocumentoRilevato,
    confidence,
    valido,
    reviewManuale,
    motiviReview,
    decisionCode,
    analysisKey,
    pipelineVersion,
    classificazione,
    estrazione,
    decisioneBackend,
    ui,
  };
}

module.exports = { buildUiResult, buildBaseResponse };
