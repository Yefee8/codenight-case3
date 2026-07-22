package com.fraudcell.identity.application;

import com.fraudcell.identity.persistence.IdentityRepository;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final IdentityRepository repository;

    public AuditService(IdentityRepository repository) {
        this.repository = repository;
    }

    public void write(UUID actorId, String actorRole, String action, String result,
                      String resourceType, String resourceId, HttpServletRequest request) {
        write(actorId, actorRole, action, result, resourceType, resourceId, request, "{}");
    }

    public void write(UUID actorId, String actorRole, String action, String result,
                      String resourceType, String resourceId, HttpServletRequest request, String detailsJson) {
        repository.audit(UUID.randomUUID(), actorId, actorRole, action, result, resourceType, resourceId,
                maskIp(request == null ? null : request.getRemoteAddr()), requestId(request), detailsJson);
    }

    private static UUID requestId(HttpServletRequest request) {
        if (request != null && request.getAttribute("fraudcell.request_id") instanceof UUID id) return id;
        return UUID.randomUUID();
    }

    static String maskIp(String ip) {
        if (ip == null || ip.isBlank()) return "unknown";
        if (ip.contains(":")) {
            String[] pieces = ip.split(":", -1);
            return String.join(":", java.util.Arrays.copyOf(pieces, Math.min(4, pieces.length))) + "::/64";
        }
        String[] pieces = ip.split("\\.");
        return pieces.length == 4 ? pieces[0] + "." + pieces[1] + "." + pieces[2] + ".0/24" : "masked";
    }
}
