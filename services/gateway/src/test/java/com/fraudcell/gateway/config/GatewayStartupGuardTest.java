package com.fraudcell.gateway.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fraudcell.gateway.security.KeyHasherTest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class GatewayStartupGuardTest {

    @Test
    void productionRejectsPlaceholderSecrets() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("APP_ENV", "production")
                .withProperty("spring.data.redis.password", "CHANGE_ME_redis_password")
                .withProperty("spring.rabbitmq.password", "012345678901234567890123456789ab");

        assertThatThrownBy(() -> new GatewayStartupGuard(KeyHasherTest.properties(), environment).afterPropertiesSet())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("GATEWAY_REDIS_PASSWORD");
    }

    @Test
    void productionAcceptsStrongSecretsAndExplicitLocalDemoOrigin() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("APP_ENV", "production")
                .withProperty("spring.data.redis.password", "8ef278ff259a44399947f18f30a01991")
                .withProperty("spring.rabbitmq.password", "71b05aed86df4a33bfc752f62ee3b100");

        assertThatCode(() -> new GatewayStartupGuard(KeyHasherTest.properties(), environment).afterPropertiesSet())
                .doesNotThrowAnyException();
    }
}
