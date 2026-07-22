package com.fraudcell.gateway.messaging;

public final class InvalidGatewayEventException extends RuntimeException {
    public InvalidGatewayEventException(String message) {
        super(message);
    }

    public InvalidGatewayEventException(String message, Throwable cause) {
        super(message, cause);
    }
}
