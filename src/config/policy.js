const POLICY = {
  pipelineVersion: "v5.0.0",
  classificationConfidenceReject: 74,
  classificationConfidenceReview: 80,
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
