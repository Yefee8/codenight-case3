package com.fraudcell.gateway.error;

import java.nio.charset.StandardCharsets;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@Component
public class GatewayErrorWriter {

    public Mono<Void> write(ServerWebExchange exchange, HttpStatus status, String code, String message) {
        if (exchange.getResponse().isCommitted()) {
            return Mono.empty();
        }
        String requestId = exchange.getRequest().getHeaders().getFirst("X-Request-ID");
        if (requestId == null) {
            requestId = "unknown";
        }
        String json = "{\"success\":false,\"data\":null,\"error\":{\"code\":\""
                + code + "\",\"message\":\"" + message + "\"},\"request_id\":\""
                + requestId + "\"}";
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        exchange.getResponse().getHeaders().setCacheControl(CacheControl.noStore());
        exchange.getResponse().getHeaders().setContentLength(bytes.length);
        return exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(bytes)));
    }
}
