package com.fraudcell.gateway.messaging;

import java.util.Map;

public interface GatewayRetryPublisher {
    void publish(byte[] body, Map<String, Object> headers, int nextAttempt, String stage);
}
