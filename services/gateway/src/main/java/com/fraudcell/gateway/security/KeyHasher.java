package com.fraudcell.gateway.security;

import com.fraudcell.gateway.config.GatewayProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public final class KeyHasher {
    private static final String ALGORITHM = "HmacSHA256";
    private final SecretKeySpec key;

    public KeyHasher(GatewayProperties properties) {
        this.key = new SecretKeySpec(properties.keyHmacSecret().getBytes(StandardCharsets.UTF_8), ALGORITHM);
    }

    public String hash(String value) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("JVM HMAC-SHA256 desteği bulunamadı.", exception);
        }
    }
}
