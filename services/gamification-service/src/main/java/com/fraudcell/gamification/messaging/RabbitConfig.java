package com.fraudcell.gamification.messaging;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.amqp.autoconfigure.RabbitTemplateCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class RabbitConfig {
    @Bean
    RabbitTemplateCustomizer mandatoryPublisher() {
        return (RabbitTemplate template) -> template.setMandatory(true);
    }
}
