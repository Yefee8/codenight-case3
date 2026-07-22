package com.fraudcell.gateway.security;

public final class SecurityStoreUnavailableException extends RuntimeException {
    public SecurityStoreUnavailableException(Throwable cause) {
        super("Gateway güvenlik durumu kullanılamıyor.", cause);
    }

    public SecurityStoreUnavailableException(String message) {
        super(message);
    }
}
