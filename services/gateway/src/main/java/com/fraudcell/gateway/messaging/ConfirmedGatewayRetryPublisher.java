package com.fraudcell.gateway.messaging;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class ConfirmedGatewayRetryPublisher implements GatewayRetryPublisher {
    static final String RETRY_EXCHANGE = "fraudcell.gateway.retry.v1";
    private final RabbitTemplate rabbit;

    public ConfirmedGatewayRetryPublisher(RabbitTemplate rabbit) {
        this.rabbit = rabbit;
        this.rabbit.setMandatory(true);
    }

    @Override
    public void publish(byte[] body, Map<String, Object> headers, int nextAttempt, String stage) {
        Message retry = MessageBuilder.withBody(body)
                .copyHeaders(headers)
                .setHeader("x-retry-attempt", nextAttempt)
                .setContentType("application/json")
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
                .build();
        CorrelationData correlation = new CorrelationData(UUID.randomUUID().toString());
        rabbit.send(RETRY_EXCHANGE, "gateway." + stage, retry, correlation);
        try {
            CorrelationData.Confirm confirm = correlation.getFuture().get(3, TimeUnit.SECONDS);
            if (!confirm.ack() || correlation.getReturned() != null) {
                throw new IllegalStateException("Gateway retry publish broker tarafından doğrulanmadı.");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Gateway retry publish kesildi.", exception);
        } catch (Exception exception) {
            throw new IllegalStateException("Gateway retry publish doğrulanamadı.", exception);
        }
    }
}
