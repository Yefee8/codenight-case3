package com.fraudcell.gateway.messaging;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;

class GatewayEventListenerTest {
    private final GatewayEventProcessor processor = mock(GatewayEventProcessor.class);
    private final GatewayRetryPublisher retryPublisher = mock(GatewayRetryPublisher.class);
    private final GatewayEventListener listener = new GatewayEventListener(processor, retryPublisher);
    private final Channel channel = mock(Channel.class);

    @Test
    void acknowledgesOnlyAfterSuccessfulProjection() throws IOException {
        Message message = message(41L, 0);
        listener.receive(message, channel);

        verify(processor).process(message.getBody());
        verify(channel).basicAck(41L, false);
        verify(retryPublisher, never()).publish(any(), anyMap(), anyInt(), anyString());
    }

    @Test
    void invalidEventIsRejectedDirectlyToDlq() throws IOException {
        Message message = message(42L, 0);
        doThrow(new InvalidGatewayEventException("bad")).when(processor).process(message.getBody());

        listener.receive(message, channel);

        verify(channel).basicReject(42L, false);
        verify(retryPublisher, never()).publish(any(), anyMap(), anyInt(), anyString());
    }

    @Test
    void transientFailureUsesConfirmedDelayStageBeforeAck() throws IOException {
        Message message = message(43L, 1);
        doThrow(new IllegalStateException("redis offline")).when(processor).process(message.getBody());

        listener.receive(message, channel);

        verify(retryPublisher).publish(message.getBody(), message.getMessageProperties().getHeaders(), 2, "30s");
        verify(channel).basicAck(43L, false);
    }

    @Test
    void failedRetryPublishRequeuesOriginalAndBudgetExhaustionRejects() throws IOException {
        Message publishFailure = message(44L, 0);
        doThrow(new IllegalStateException("redis offline")).when(processor).process(publishFailure.getBody());
        doThrow(new IllegalStateException("broker unconfirmed"))
                .when(retryPublisher).publish(any(), anyMap(), anyInt(), anyString());
        listener.receive(publishFailure, channel);
        verify(channel).basicNack(44L, false, true);

        Message exhausted = message(45L, 5);
        doThrow(new IllegalStateException("redis offline")).when(processor).process(exhausted.getBody());
        listener.receive(exhausted, channel);
        verify(channel).basicReject(45L, false);
    }

    private static Message message(long deliveryTag, int attempt) {
        Message message = MessageBuilder.withBody("{}".getBytes())
                .setMessageId("event-1")
                .setHeader("x-retry-attempt", attempt)
                .build();
        message.getMessageProperties().setDeliveryTag(deliveryTag);
        return message;
    }
}
