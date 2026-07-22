package com.fraudcell.transaction.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fraudcell.transaction.api.DomainViolation;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class CaseRulesTest {
    @Test void exactCaseSlaValuesAreUsed() {
        assertThat(CaseRules.sla("KRITIK")).isEqualTo(Duration.ofMinutes(15));
        assertThat(CaseRules.sla("YUKSEK")).isEqualTo(Duration.ofHours(1));
        assertThat(CaseRules.sla("ORTA")).isEqualTo(Duration.ofHours(4));
        assertThat(CaseRules.sla("DUSUK")).isEqualTo(Duration.ofHours(24));
    }
    @Test void invalidStateJumpIsRejected() {
        CaseRules.requireTransition("ATANDI", "INCELENIYOR");
        assertThatThrownBy(() -> CaseRules.requireTransition("YENI", "BLOKLANDI"))
                .isInstanceOf(DomainViolation.class);
    }
}
