package com.fraudcell.transaction.domain;

import com.fraudcell.transaction.api.DomainViolation;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

public final class CaseRules {
    private CaseRules() {}
    private static final Map<String, Set<String>> ALLOWED = Map.of(
            "YENI", Set.of("ATANDI"),
            "ATANDI", Set.of("INCELENIYOR"),
            "INCELENIYOR", Set.of("MUSTERI_DOGRULAMA", "ONAYLANDI", "BLOKLANDI"),
            "MUSTERI_DOGRULAMA", Set.of("INCELENIYOR"),
            "ONAYLANDI", Set.of("KAPANDI"),
            "BLOKLANDI", Set.of(),
            "KAPANDI", Set.of());

    public static void requireTransition(String from, String to) {
        if (!ALLOWED.getOrDefault(from, Set.of()).contains(to)) {
            throw DomainViolation.invalidState(from + " durumundan " + to + " durumuna geçilemez.");
        }
    }

    public static Duration sla(String riskLevel) {
        return switch (riskLevel) {
            case "KRITIK" -> Duration.ofMinutes(15);
            case "YUKSEK", "BELIRSIZ" -> Duration.ofHours(1);
            case "ORTA" -> Duration.ofHours(4);
            case "DUSUK" -> Duration.ofHours(24);
            default -> throw new IllegalArgumentException("unsupported risk level");
        };
    }

    public static Instant dueAt(String riskLevel, Instant createdAt) {
        return createdAt.plus(sla(riskLevel));
    }
}
