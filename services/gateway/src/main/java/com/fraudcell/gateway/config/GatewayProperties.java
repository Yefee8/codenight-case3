package com.fraudcell.gateway.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "fraudcell.gateway")
public record GatewayProperties(
        @NotBlank @Pattern(regexp = "https?://.+") String identityBaseUrl,
        @NotBlank @Pattern(regexp = "https?://.+") String transactionBaseUrl,
        @NotBlank @Pattern(regexp = "https?://.+") String aiBaseUrl,
        @NotBlank @Pattern(regexp = "https?://.+") String gamificationBaseUrl,
        @NotBlank String issuer,
        @NotBlank String audience,
        @NotBlank @Pattern(regexp = "https?://.+") String jwksUri,
        @NotBlank @Size(min = 32) String keyHmacSecret,
        List<@Pattern(regexp = "https?://.+") String> allowedOrigins,
        Duration accessTokenMaximumTtl
) {
    public GatewayProperties {
        allowedOrigins = allowedOrigins == null ? List.of("http://localhost:3000") : List.copyOf(allowedOrigins);
        accessTokenMaximumTtl = accessTokenMaximumTtl == null ? Duration.ofMinutes(20) : accessTokenMaximumTtl;
    }
}
