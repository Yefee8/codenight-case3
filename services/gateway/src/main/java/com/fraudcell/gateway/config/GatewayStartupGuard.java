package com.fraudcell.gateway.config;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class GatewayStartupGuard implements InitializingBean {
    private final GatewayProperties properties;
    private final Environment environment;

    public GatewayStartupGuard(GatewayProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    @Override
    public void afterPropertiesSet() {
        String appEnvironment = environment.getProperty("APP_ENV", "development");
        if (!"production".equalsIgnoreCase(appEnvironment)) {
            return;
        }
        rejectWeakSecret("GATEWAY_KEY_HMAC_SECRET", properties.keyHmacSecret());
        rejectWeakSecret("GATEWAY_REDIS_PASSWORD", environment.getProperty("spring.data.redis.password"));
        rejectWeakSecret("GATEWAY_RABBITMQ_PASSWORD", environment.getProperty("spring.rabbitmq.password"));
        if (!properties.issuer().startsWith("https://")) {
            throw new IllegalStateException("Production JWT issuer HTTPS olmalıdır.");
        }
        for (String origin : properties.allowedOrigins()) {
            URI uri = URI.create(origin);
            boolean localDevelopmentOrigin = "localhost".equalsIgnoreCase(uri.getHost())
                    || "127.0.0.1".equals(uri.getHost());
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !localDevelopmentOrigin) {
                throw new IllegalStateException("Production CORS origin HTTPS veya açık localhost olmalıdır.");
            }
        }
    }

    private static void rejectWeakSecret(String name, String secret) {
        String normalized = secret == null ? "" : secret.toLowerCase(Locale.ROOT);
        List<String> forbidden = List.of("change_me", "change-me", "password", "secret-here");
        if (secret == null || secret.length() < 24 || forbidden.stream().anyMatch(normalized::contains)) {
            throw new IllegalStateException(name + " production için güçlü ve benzersiz olmalıdır.");
        }
    }
}
