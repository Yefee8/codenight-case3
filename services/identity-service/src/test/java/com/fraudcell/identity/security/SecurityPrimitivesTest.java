package com.fraudcell.identity.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SecurityPrimitivesTest {
    @Test
    void passwordPolicyMatchesCaseRules() {
        assertThat(PasswordPolicy.valid("Analyst123!")).isTrue();
        assertThat(PasswordPolicy.valid("analyst123!")).isFalse();
        assertThat(PasswordPolicy.valid("Analyst!!!")).isFalse();
        assertThat(PasswordPolicy.valid("Ana1!")).isFalse();
    }

    @Test
    void opaqueTokensAreRandomAndOnlyHashesAreStable() {
        String first = SecretTokens.randomOpaque();
        String second = SecretTokens.randomOpaque();
        assertThat(first).isNotEqualTo(second).hasSizeGreaterThan(40);
        assertThat(SecretTokens.sha256(first)).isEqualTo(SecretTokens.sha256(first)).hasSize(64);
    }
}
