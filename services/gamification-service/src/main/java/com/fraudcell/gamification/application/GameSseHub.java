package com.fraudcell.gamification.application;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Component
public class GameSseHub {
    private final Map<UUID, CopyOnWriteArrayList<SseEmitter>> clients = new ConcurrentHashMap<>();

    public SseEmitter subscribe(UUID analystId) {
        var emitter = new SseEmitter(0L);
        clients.computeIfAbsent(analystId, ignored -> new CopyOnWriteArrayList<>()).add(emitter);
        Runnable remove = () -> remove(analystId, emitter);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(ignored -> remove.run());
        try {
            emitter.send(SseEmitter.event().comment("connected"));
        } catch (IOException exception) {
            remove.run();
            emitter.completeWithError(exception);
        }
        return emitter;
    }

    public void publish(UUID analystId, UUID eventId, String eventType, Object data) {
        for (var emitter : clients.getOrDefault(analystId, new CopyOnWriteArrayList<>())) {
            try {
                emitter.send(SseEmitter.event().id(eventId.toString()).name(eventType).data(data));
            } catch (IOException exception) {
                remove(analystId, emitter);
                emitter.complete();
            }
        }
    }

    private void remove(UUID analystId, SseEmitter emitter) {
        var emitters = clients.get(analystId);
        if (emitters == null) return;
        emitters.remove(emitter);
        if (emitters.isEmpty()) clients.remove(analystId, emitters);
    }
}
