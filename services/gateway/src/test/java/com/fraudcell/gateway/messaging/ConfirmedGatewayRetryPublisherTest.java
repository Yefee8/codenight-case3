package com.fraudcell.gateway.messaging;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

class ConfirmedGatewayRetryPublisherTest {

    @Test
    void acceptsBrokerConfirmedPublish() {
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(3);
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(eq("fraudcell.gateway.retry.v1"), eq("gateway.5s"),
                any(Message.class), any(CorrelationData.class));
        ConfirmedGatewayRetryPublisher publisher = new ConfirmedGatewayRetryPublisher(rabbit);

        publisher.publish("{}".getBytes(), Map.of(), 1, "5s");

        verify(rabbit).setMandatory(true);
        verify(rabbit).send(eq("fraudcell.gateway.retry.v1"), eq("gateway.5s"),
                any(Message.class), any(CorrelationData.class));
    }

    @Test
    void treatsBrokerNackAsPublishFailure() {
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(3);
            correlation.getFuture().complete(new CorrelationData.Confirm(false, "nack"));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        ConfirmedGatewayRetryPublisher publisher = new ConfirmedGatewayRetryPublisher(rabbit);

        assertThatThrownBy(() -> publisher.publish("{}".getBytes(), Map.of(), 1, "5s"))
                .isInstanceOf(IllegalStateException.class);
    }

}
