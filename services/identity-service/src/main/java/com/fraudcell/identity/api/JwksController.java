package com.fraudcell.identity.api;

import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class JwksController {
    private final Map<String, Object> jwks;

    public JwksController(@Qualifier("publicJwks") Map<String, Object> jwks) {
        this.jwks = jwks;
    }

    @GetMapping("/.well-known/jwks.json")
    public Map<String, Object> keys() {
        return jwks;
    }
}
