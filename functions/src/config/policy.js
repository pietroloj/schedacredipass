const POLICY = {
  pipelineVersion: "v6.0.0-predelibera2",
  classificationConfidenceReject: 0.74,
  classificationConfidenceReview: 0.80,
  maxCriticitaPenalty: 24,
  dtiWarning: 35,
  dtiCritical: 45,
  enableIdempotencyCache: true,
  requireManualReviewOnPartialDocument: true,
  requireManualReviewOnMissingIncomeCoreFields: true,
  requireManualReviewOnMissingIdentityCoreFields: true,
  requireManualReviewOnRealEstateMismatch: true,
};

module.exports = { POLICY };
