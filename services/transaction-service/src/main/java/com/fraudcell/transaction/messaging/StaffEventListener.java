package com.fraudcell.transaction.messaging;

import com.fraudcell.transaction.security.RlsContext;
import com.rabbitmq.client.Channel;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class StaffEventListener {
    private final JdbcTemplate jdbc; private final RlsContext rls; private final JsonMapper json;
    private final TransactionTemplate transactions;
    public StaffEventListener(JdbcTemplate jdbc, RlsContext rls, JsonMapper json,
                              PlatformTransactionManager transactionManager) {
        this.jdbc=jdbc; this.rls=rls; this.json=json;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    @RabbitListener(queues = "${fraudcell.rabbit.queue:fraudcell.transaction.events.v1}")
    public void receive(Message message, Channel channel) throws Exception {
        long tag=message.getMessageProperties().getDeliveryTag();
        try {
            transactions.executeWithoutResult(ignored -> {
                try { process(message.getBody()); }
                catch (RuntimeException error) { throw error; }
                catch (Exception error) { throw new IllegalStateException(error); }
            });
            channel.basicAck(tag,false);
        }
        catch (IllegalArgumentException poison) { channel.basicNack(tag,false,false); }
        catch (Exception transientFailure) { channel.basicNack(tag,false,true); }
    }

    void process(byte[] body) throws Exception {
        rls.service(); JsonNode event=json.readTree(body);
        UUID eventId=UUID.fromString(required(event,"event_id"));
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        int inserted=jdbc.update("INSERT INTO inbox_events(event_id,event_type,aggregate_id,aggregate_version,payload_hash) " +
                        "VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING", eventId,required(event,"event_type"),
                UUID.fromString(required(event,"aggregate_id")),event.path("aggregate_version").asLong(),hash);
        if(inserted==0) {
            String old=jdbc.queryForObject("SELECT payload_hash FROM inbox_events WHERE event_id=?",String.class,eventId);
            if(!hash.equals(old)) throw new IllegalArgumentException("event id payload mismatch");
            return;
        }
        String type=required(event,"event_type"); JsonNode payload=event.path("payload");
        if(!type.startsWith("staff.") && !"role.changed".equals(type)) return;
        UUID id=UUID.fromString(first(payload,"staff_id","user_id"));
        String role=text(payload,"role","ANALYST");
        if(!"ANALYST".equals(role)) {
            jdbc.update("DELETE FROM staff_projection WHERE analyst_id=?",id); return;
        }
        String display=text(payload,"display_name", text(payload,"email","Analist-"+id.toString().substring(0,8)));
        String status=text(payload,"status","ACTIVE");
        String specialties=payload.has("specialties")?json.writeValueAsString(payload.get("specialties")):"[]";
        String regions=payload.has("regions")?json.writeValueAsString(payload.get("regions")):"[]";
        jdbc.update("""
                INSERT INTO staff_projection(analyst_id,display_name,role,status,locked,specialties,regions,aggregate_version)
                VALUES (?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?)
                ON CONFLICT(analyst_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,
                  status=EXCLUDED.status,locked=EXCLUDED.locked,specialties=EXCLUDED.specialties,
                  regions=EXCLUDED.regions,aggregate_version=EXCLUDED.aggregate_version,updated_at=now()
                WHERE EXCLUDED.aggregate_version >= staff_projection.aggregate_version
                """,id,display,role,status,payload.path("locked").asBoolean(false),specialties,regions,
                event.path("aggregate_version").asLong());
    }
    private static String required(JsonNode node,String field){if(!node.hasNonNull(field))throw new IllegalArgumentException("missing "+field);return node.get(field).asText();}
    private static String first(JsonNode node,String a,String b){if(node.hasNonNull(a))return node.get(a).asText();return required(node,b);}
    private static String text(JsonNode node,String field,String fallback){return node.hasNonNull(field)?node.get(field).asText():fallback;}
}
