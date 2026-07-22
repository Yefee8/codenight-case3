package com.fraudcell.transaction.application;

import com.fraudcell.transaction.security.RequestPrincipal;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Component
public class TransactionSseHub {
    private final Map<UUID, CopyOnWriteArrayList<Client>> clients = new ConcurrentHashMap<>();

    public SseEmitter subscribe(RequestPrincipal principal) {
        var emitter = new SseEmitter(0L);
        var client = new Client(principal.role(), emitter);
        clients.computeIfAbsent(principal.userId(), ignored -> new CopyOnWriteArrayList<>()).add(client);
        Runnable remove = () -> remove(principal.userId(), client);
        emitter.onCompletion(remove); emitter.onTimeout(remove); emitter.onError(ignored -> remove.run());
        try { emitter.send(SseEmitter.event().comment("connected")); }
        catch (IOException error) { remove.run(); emitter.completeWithError(error); }
        return emitter;
    }

    public void publish(UUID eventId, UUID customerId, UUID analystId, Object data) {
        clients.forEach((userId, subscriptions) -> subscriptions.forEach(client -> {
            boolean allowed = userId.equals(customerId) || (analystId != null && userId.equals(analystId))
                    || "SUPERVISOR".equals(client.role()) || "ADMIN".equals(client.role());
            if (!allowed) return;
            try { client.emitter().send(SseEmitter.event().id(eventId.toString()).name("case.updated").data(data)); }
            catch (IOException error) { remove(userId, client); client.emitter().complete(); }
        }));
    }

    private void remove(UUID id, Client client) {
        var values = clients.get(id); if (values == null) return;
        values.remove(client); if (values.isEmpty()) clients.remove(id, values);
    }
    private record Client(String role, SseEmitter emitter) {}
}
