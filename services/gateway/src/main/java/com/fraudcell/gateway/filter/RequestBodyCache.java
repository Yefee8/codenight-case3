package com.fraudcell.gateway.filter;

import java.util.List;
import java.util.Locale;
import org.reactivestreams.Publisher;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class RequestBodyCache {
    public static final int MAX_BODY_BYTES = 64 * 1024;
    private static final List<String> ACCOUNT_FIELDS = List.of("gsm", "email", "phone_number", "username");

    private final ObjectMapper objectMapper;

    public RequestBodyCache(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Mono<InspectedRequest> inspect(ServerWebExchange exchange) {
        if (!canHaveBody(exchange.getRequest().getMethod())) {
            return Mono.just(new InspectedRequest(exchange, null));
        }
        long contentLength = exchange.getRequest().getHeaders().getContentLength();
        if (contentLength > MAX_BODY_BYTES) {
            return Mono.error(new RequestBodyTooLargeException());
        }
        return DataBufferUtils.join(exchange.getRequest().getBody(), MAX_BODY_BYTES)
                .map(buffer -> cache(exchange, buffer))
                .switchIfEmpty(Mono.just(new InspectedRequest(exchange, null)));
    }

    private InspectedRequest cache(ServerWebExchange exchange, DataBuffer buffer) {
        byte[] bytes = new byte[buffer.readableByteCount()];
        buffer.read(bytes);
        DataBufferUtils.release(buffer);
        String accountIdentifier = extractAccountIdentifier(bytes);
        ServerHttpRequestDecorator request = new ServerHttpRequestDecorator(exchange.getRequest()) {
            @Override
            public Flux<DataBuffer> getBody() {
                return Flux.defer(() -> Flux.just(exchange.getResponse().bufferFactory().wrap(bytes)));
            }
        };
        return new InspectedRequest(exchange.mutate().request(request).build(), accountIdentifier);
    }

    private String extractAccountIdentifier(byte[] bytes) {
        if (bytes.length == 0) {
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(bytes);
            for (String field : ACCOUNT_FIELDS) {
                JsonNode value = root.get(field);
                if (value != null && value.isString() && !value.asString().isBlank()) {
                    return value.asString().strip().toLowerCase(Locale.ROOT);
                }
            }
        } catch (RuntimeException ignored) {
            // Syntax/validation remains the destination service's responsibility.
        }
        return null;
    }

    private static boolean canHaveBody(HttpMethod method) {
        return method == HttpMethod.POST || method == HttpMethod.PUT || method == HttpMethod.PATCH;
    }

    public record InspectedRequest(ServerWebExchange exchange, String accountIdentifier) {
    }

    public static final class RequestBodyTooLargeException extends RuntimeException {
    }
}
