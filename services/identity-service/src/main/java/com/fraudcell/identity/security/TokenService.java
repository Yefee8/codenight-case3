package com.fraudcell.identity.security;

import com.fraudcell.identity.domain.IdentityUser;
import com.nimbusds.jose.jwk.RSAKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;
    private final String keyId;
    private final long accessMinutes;

    public TokenService(JwtEncoder encoder,
                        @Value("${fraudcell.jwt.issuer}") String issuer,
                        @Value("${fraudcell.jwt.audience}") String audience,
                        RSAKey rsaKey,
                        @Value("${fraudcell.jwt.access-minutes}") long accessMinutes) {
        this.encoder = encoder;
        this.issuer = issuer;
        this.audience = audience;
        this.keyId = rsaKey.getKeyID();
        this.accessMinutes = accessMinutes;
    }

    public AccessToken issue(IdentityUser user, UUID sessionId) {
        Instant now = Instant.now();
        Instant expires = now.plus(accessMinutes, ChronoUnit.MINUTES);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(List.of(audience))
                .subject(user.id().toString())
                .id(UUID.randomUUID().toString())
                .issuedAt(now)
                .expiresAt(expires)
                .claim("user_id", user.id().toString())
                .claim("session_id", sessionId.toString())
                .claim("session_epoch", user.sessionEpoch())
                .claim("role", user.role().name())
                .claim("specialty", user.specialties().isEmpty() ? "" : user.specialties().getFirst())
                .claim("region", user.regions().isEmpty() ? "" : user.regions().getFirst())
                .claim("specialties", user.specialties())
                .claim("regions", user.regions())
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
        String value = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new AccessToken(value, expires.getEpochSecond() - now.getEpochSecond());
    }

    public record AccessToken(String value, long expiresIn) {}
}
