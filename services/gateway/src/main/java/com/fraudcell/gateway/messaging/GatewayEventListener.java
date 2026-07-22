package com.fraudcell.gateway.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class GatewayEventListener {
    private static final Logger LOG = LoggerFactory.getLogger(GatewayEventListener.class);
    private static final List<String> RETRY_STAGES = List.of("5s", "30s", "2m", "10m", "30m");

    private final GatewayEventProcessor processor;
    private final GatewayRetryPublisher retryPublisher;

    public GatewayEventListener(GatewayEventProcessor processor, GatewayRetryPublisher retryPublisher) {
        this.processor = processor;
        this.retryPublisher = retryPublisher;
    }

    @RabbitListener(queues = "${fraudcell.rabbit.queue:fraudcell.gateway.events.v1}")
    public void receive(Message message, Channel channel) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        try {
            processor.process(message.getBody());
            channel.basicAck(tag, false);
        } catch (InvalidGatewayEventException invalid) {
            LOG.warn("invalid gateway security event rejected; message_id={}",
                    message.getMessageProperties().getMessageId());
            channel.basicReject(tag, false);
        } catch (RuntimeException transientFailure) {
            int attempt = retryAttempt(message);
            if (attempt >= RETRY_STAGES.size()) {
                LOG.error("gateway security event exhausted retry budget; message_id={}",
                        message.getMessageProperties().getMessageId());
                channel.basicReject(tag, false);
                return;
            }
            try {
                retryPublisher.publish(message.getBody(), message.getMessageProperties().getHeaders(),
                        attempt + 1, RETRY_STAGES.get(attempt));
                channel.basicAck(tag, false);
            } catch (RuntimeException publishFailure) {
                channel.basicNack(tag, false, true);
            }
        }
    }

    private static int retryAttempt(Message message) {
        Object value = message.getMessageProperties().getHeaders().get("x-retry-attempt");
        if (!(value instanceof Number number)) {
            return 0;
        }
        return Math.max(0, number.intValue());
    }
}
