package com.fraudcell.transaction.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class TransactionDtos {
    private TransactionDtos() {}

    public record CreateTransactionRequest(
            @NotNull @DecimalMin("0.01") @DecimalMax("1000000000") BigDecimal amount,
            @NotBlank @Pattern(regexp = "ODEME|TRANSFER|FATURA|CEKIM") String transactionType,
            @NotBlank @Size(max = 200) String recipient,
            @NotBlank @Size(max = 100) String sourceDevice,
            @NotBlank @Size(max = 100) String city,
            @NotBlank @Pattern(regexp = "[A-Z]{2}") String countryCode,
            @NotNull Instant occurredAt) {}

    public record TransactionView(
            UUID id, String transactionNumber, String amount, String currency,
            String transactionType, String recipient, String sourceDevice, String city,
            String countryCode, Instant occurredAt, String predictionStatus,
            Double riskScore, String riskLevel, String fraudType, String decision,
            String modelVersion, List<String> reasonCodes, UUID caseId, String caseStatus) {}

    public record RiskCaseView(
            UUID id, TransactionView transaction, UUID customerId, UUID assignedAnalystId,
            String status, String riskLevel, String fraudType, Double rawAiScore,
            Double effectiveScore, String holdStatus, String queueReason, Instant dueAt,
            Instant createdAt, long version, String customerVerification) {}

    public record PageView<T>(List<T> items, int page, int size, long total) {}
    public record VersionRequest(@Min(0) long version) {}
    public record VerificationRequest(
            @NotBlank @Pattern(regexp = "CUSTOMER_CONFIRMED|CUSTOMER_DENIED") String response) {}
    public record DecisionRequest(
            @NotBlank @Pattern(regexp = "ONAYLANDI|BLOKLANDI") String decision,
            @NotBlank @Size(max = 2000) String note,
            @Min(0) long version) {}
    public record FraudTypeRequest(
            @NotBlank @Pattern(regexp = "CALINTI_KART|HESAP_ELE_GECIRME|PARA_AKLAMA|SUPHELI_DAVRANIS|TEMIZ") String fraudType,
            @NotBlank @Size(max = 500) String reason, @Min(0) long version) {}
    public record RiskLevelRequest(
            @NotBlank @Pattern(regexp = "DUSUK|ORTA|YUKSEK|KRITIK") String riskLevel,
            @NotBlank @Size(max = 500) String reason, @Min(0) long version) {}
    public record AssignmentRequest(
            @NotNull UUID analystId, @Min(0) long version,
            @NotBlank @Size(max = 500) String reason, boolean overrideCapacity) {}
    public record FeedbackRequest(@Min(1) @Max(5) int score) {}
    public record GroundTruthRequest(
            @NotBlank @Pattern(regexp = "FRAUD|LEGITIMATE") String truth,
            @Pattern(regexp = "CALINTI_KART|HESAP_ELE_GECIRME|PARA_AKLAMA|SUPHELI_DAVRANIS|TEMIZ") String fraudType,
            @Min(0) long version) {}

    public record NamedCount(String name, long value) {}
    public record RiskTrend(Instant bucket, String riskLevel, long value) {}
    public record CategoryAccuracy(String category, double accuracy, long sampleSize) {}
    public record AnalystPerformance(UUID analystId, String name, long decisionCount,
                                     double averageMinutes, Double accuracy) {}
    public record OperationsDashboard(
            Instant generatedAt, boolean stale, List<String> partialSources,
            List<NamedCount> fraudTypeDistribution, List<NamedCount> riskDistribution,
            List<RiskTrend> riskTrend, double slaComplianceRate, long activeSlaBreaches,
            Double aiAccuracy, Double falsePositiveRate,
            List<CategoryAccuracy> categoryAccuracy,
            List<AnalystPerformance> analystPerformance,
            List<RiskCaseView> manualQueue) {}

    public record AnalystCandidate(
            UUID analystId, List<String> specialties, List<String> regions,
            int activeCaseCount, Double performance, String status,
            boolean locked, Instant lastAssignedAt) {}
    public record AiFeatures(
            UUID customerId, String city, String region, String countryCode,
            String transactionType, BigDecimal amount, int hour,
            boolean newDevice, boolean newRecipient,
            @JsonProperty("frequency_1h") int frequency1h,
            @JsonProperty("frequency_24h") int frequency24h,
            double deviationScore) {}
    public record AiScoreRequest(UUID transactionId, UUID caseId, AiFeatures features,
                                 List<AnalystCandidate> candidates) {}
    public record RankedCandidate(UUID analystId, double score, double expertiseMatch,
                                  double availability, double performance, boolean regionMatch) {}
    public record AiScoreResponse(
            UUID predictionId, String modelVersion, String featureSchemaVersion,
            double riskScore, String riskLevel, String decision, String fraudType,
            List<String> reasonCodes, List<RankedCandidate> rankedCandidates) {}
}
