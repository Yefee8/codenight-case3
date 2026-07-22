package com.fraudcell.gamification.messaging;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class GamificationEventListener {
    private static final Logger LOG = LoggerFactory.getLogger(GamificationEventListener.class);
    private static final List<String> RETRY_STAGES = List.of("5s", "30s", "2m", "10m", "30m");
    private final GamificationEventProcessor processor;
    private final RabbitTemplate rabbit;

    public GamificationEventListener(GamificationEventProcessor processor, RabbitTemplate rabbit) {
        this.processor = processor;
        this.rabbit = rabbit;
    }

    @RabbitListener(queues = "${fraudcell.rabbit.queue:fraudcell.gamification.events.v1}")
    public void receive(Message message, Channel channel) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        try {
            processor.process(message.getBody());
            channel.basicAck(tag, false);
        } catch (Exception processingFailure) {
            int attempt = retryAttempt(message);
            if (attempt >= RETRY_STAGES.size()) {
                LOG.error("event moved to gamification DLQ after retry budget; message_id={}",
                        message.getMessageProperties().getMessageId());
                channel.basicNack(tag, false, false);
                return;
            }
            try {
                Message retry = MessageBuilder.withBody(message.getBody())
                        .copyHeaders(message.getMessageProperties().getHeaders())
                        .setHeader("x-retry-attempt", attempt + 1)
                        .setContentType("application/json")
                        .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
                        .build();
                var confirmation = new CorrelationData(
                        String.valueOf(message.getMessageProperties().getMessageId()) + ":retry:" + (attempt + 1));
                rabbit.send("fraudcell.gamification.retry.v1",
                        "gamification." + RETRY_STAGES.get(attempt), retry, confirmation);
                var result = confirmation.getFuture().get(5, TimeUnit.SECONDS);
                if (!result.isAck() || confirmation.getReturned() != null) {
                    throw new IllegalStateException("retry publish was not confirmed");
                }
                channel.basicAck(tag, false);
            } catch (Exception publishFailure) {
                channel.basicNack(tag, false, true);
            }
        }
    }

    private static int retryAttempt(Message message) {
        Object value = message.getMessageProperties().getHeaders().get("x-retry-attempt");
        return value instanceof Number number ? number.intValue() : 0;
    }
}
