package com.fraudcell.transaction.application;

import static com.fraudcell.transaction.api.TransactionDtos.*;

import com.fraudcell.transaction.api.DomainViolation;
import com.fraudcell.transaction.domain.CaseRules;
import com.fraudcell.transaction.messaging.EventOutbox;
import com.fraudcell.transaction.security.RequestPrincipal;
import com.fraudcell.transaction.security.RlsContext;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class TransactionFacade {
    private static final String TRANSACTION_SELECT = """
            SELECT t.id,t.transaction_number,t.amount,t.currency,t.transaction_type,t.recipient,
                   t.source_device,t.city,t.country_code,t.occurred_at,
                   c.id AS case_id,c.status AS case_status,c.prediction_status,c.raw_ai_score,
                   c.risk_level,c.fraud_type,c.ai_decision,c.model_version,c.reason_codes
              FROM transactions t JOIN risk_cases c ON c.transaction_id=t.id
            """;
    private static final String CASE_SELECT = """
            SELECT c.*,t.transaction_number,t.amount,t.currency,t.transaction_type,t.recipient,
                   t.source_device,t.city,t.country_code,t.occurred_at
              FROM risk_cases c JOIN transactions t ON t.id=c.transaction_id
            """;

    private final JdbcTemplate jdbc; private final RlsContext rls; private final EventOutbox outbox;
    private final JsonMapper json; private final RestClient ai; private final String aiToken;
    private final Clock clock; private final TransactionSseHub sse;

    public TransactionFacade(JdbcTemplate jdbc, RlsContext rls, EventOutbox outbox, JsonMapper json,
                             RestClient.Builder builder, Clock clock, TransactionSseHub sse,
                             @Value("${fraudcell.ai.base-url}") String aiBase,
                             @Value("${fraudcell.ai.internal-token}") String aiToken,
                             @Value("${fraudcell.ai.connect-timeout:500ms}") Duration connectTimeout,
                             @Value("${fraudcell.ai.read-timeout:1500ms}") Duration readTimeout) {
        this.jdbc=jdbc; this.rls=rls; this.outbox=outbox; this.json=json; this.clock=clock; this.sse=sse;
        var factory=new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout); factory.setReadTimeout(readTimeout);
        this.ai=builder.baseUrl(aiBase).requestFactory(factory).build(); this.aiToken=aiToken;
    }

    @Transactional
    public TransactionView create(RequestPrincipal principal, CreateTransactionRequest request,
                                  String idempotencyKey, UUID requestId) {
        if (!"CUSTOMER".equals(principal.role())) throw forbidden();
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length()>100)
            throw new DomainViolation(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_REQUIRED","Geçerli Idempotency-Key gerekli.");
        rls.service();
        String requestHash=hash(request.toString());
        var existing=jdbc.query("SELECT request_hash,transaction_id FROM idempotency_records WHERE actor_id=? AND idempotency_key=?",
                (rs,row)->new Existing(rs.getString(1),rs.getObject(2,UUID.class)),principal.userId(),idempotencyKey);
        if(!existing.isEmpty()) {
            if(!existing.getFirst().hash().equals(requestHash))
                throw new DomainViolation(HttpStatus.CONFLICT,"IDEMPOTENCY_MISMATCH","Aynı anahtar farklı istekle kullanılamaz.");
            return transaction(existing.getFirst().transactionId());
        }

        FeatureContext features=features(principal.userId(),request);
        UUID transactionId=UUID.randomUUID(), caseId=UUID.randomUUID(); Instant now=Instant.now(clock);
        Long sequence=jdbc.queryForObject("SELECT nextval('transaction_number_seq')",Long.class);
        String number="TRX-"+now.atZone(ZoneOffset.UTC).getYear()+"-"+String.format(Locale.ROOT,"%08d",sequence);
        jdbc.update("""
                INSERT INTO transactions(id,transaction_number,customer_id,amount,currency,transaction_type,
                  recipient,source_device,city,country_code,occurred_at)
                VALUES (?,?,?,?, 'TRY',?,?,?,?,?,?)
                """,transactionId,number,principal.userId(),request.amount(),request.transactionType(),
                request.recipient(),request.sourceDevice(),request.city(),request.countryCode(),db(request.occurredAt()));
        jdbc.update("""
                INSERT INTO risk_cases(id,transaction_id,customer_id,status,prediction_status,risk_level,
                  fraud_type,ai_decision,due_at,queue_reason)
                VALUES (?,?,?,'YENI','PENDING','BELIRSIZ','BELIRSIZ','INCELEME',?,'AI_PENDING')
                """,caseId,transactionId,principal.userId(),db(CaseRules.dueAt("BELIRSIZ",now)));
        jdbc.update("INSERT INTO case_status_history(case_id,from_status,to_status,actor_id,actor_role,reason) " +
                "VALUES (?,NULL,'YENI',?,'CUSTOMER','transaction created')",caseId,principal.userId());
        jdbc.update("INSERT INTO idempotency_records(actor_id,idempotency_key,request_hash,transaction_id) VALUES (?,?,?,?)",
                principal.userId(),idempotencyKey,requestHash,transactionId);
        outbox.enqueue("transaction.created",transactionId,1,requestId,null,Map.of(
                "transaction_id",transactionId,"case_id",caseId,"customer_id",principal.userId(),
                "transaction_number",number,"amount",request.amount(),"transaction_type",request.transactionType()));

        AiScoreResponse score=null;
        try { score=score(transactionId,caseId,principal.userId(),request,features); }
        catch (RuntimeException ignored) { /* explicit fallback below; no synthetic score */ }
        if(score==null) unavailable(caseId,transactionId,principal.userId(),requestId,now);
        else assessed(caseId,transactionId,principal.userId(),score,requestId,now);
        return transaction(transactionId);
    }

    private void unavailable(UUID caseId,UUID transactionId,UUID customerId,UUID requestId,Instant now) {
        jdbc.update("""
                UPDATE risk_cases SET prediction_status='UNAVAILABLE',risk_level='BELIRSIZ',fraud_type='BELIRSIZ',
                  ai_decision='INCELEME',raw_ai_score=NULL,effective_score=NULL,hold_status=NULL,
                  queue_reason='AI_UNAVAILABLE',due_at=?,updated_at=now(),version=version+1 WHERE id=?
                """,db(CaseRules.dueAt("BELIRSIZ",now)),caseId);
        outbox.enqueue("transaction.analysis-unavailable",transactionId,2,requestId,null,Map.of(
                "transaction_id",transactionId,"case_id",caseId,"reason","AI_UNAVAILABLE"));
        UUID event=outbox.enqueue("case.created",caseId,1,requestId,null,Map.of(
                "case_id",caseId,"transaction_id",transactionId,
                "risk_level","BELIRSIZ","due_at",CaseRules.dueAt("BELIRSIZ",now)));
        notifyAfterCommit(event,customerId,null,caseId,"AI erişilemedi; vaka manuel kuyruğa alındı.");
    }

    private void assessed(UUID caseId,UUID transactionId,UUID customerId,AiScoreResponse score,
                          UUID requestId,Instant now) {
        UUID analyst=null; String status="YENI", queue=null;
        if("ONAY".equals(score.decision())) status="ONAYLANDI";
        else {
            analyst=reserve(score.rankedCandidates());
            if(analyst!=null) status="ATANDI"; else queue="CAPACITY_WAIT";
        }
        String hold="BLOK".equals(score.decision())?"TEMPORARY_BLOCK":null;
        Instant due=CaseRules.dueAt(score.riskLevel(),now);
        jdbc.update("""
                UPDATE risk_cases SET assigned_analyst_id=?,status=?,prediction_status='AVAILABLE',
                  risk_level=?,fraud_type=?,ai_decision=?,raw_ai_score=?,effective_score=?,prediction_id=?,
                  model_version=?,reason_codes=CAST(? AS jsonb),hold_status=?,queue_reason=?,due_at=?,
                  decided_at=CASE WHEN ?='ONAYLANDI' THEN now() ELSE NULL END,
                  updated_at=now(),version=version+1 WHERE id=?
                """,analyst,status,score.riskLevel(),score.fraudType(),score.decision(),score.riskScore(),score.riskScore(),
                score.predictionId(),score.modelVersion(),write(score.reasonCodes()),hold,queue,db(due),status,caseId);
        outbox.enqueue("transaction.risk-assessed",transactionId,2,requestId,null,Map.of(
                "transaction_id",transactionId,"case_id",caseId,"prediction_id",score.predictionId(),
                "risk_score",score.riskScore(),"risk_level",score.riskLevel(),"fraud_type",score.fraudType(),
                "decision",score.decision(),"model_version",score.modelVersion()));
        UUID created=outbox.enqueue("case.created",caseId,1,requestId,null,Map.of(
                "case_id",caseId,"transaction_id",transactionId,"risk_level",score.riskLevel(),"due_at",due));
        if(analyst!=null) outbox.enqueue("case.assigned",caseId,1,requestId,created,Map.of(
                "case_id",caseId,"analyst_id",analyst,"assignment_source","AI"));
        notifyAfterCommit(created,customerId,analyst,caseId,"Risk analizi tamamlandı.");
    }

    private AiScoreResponse score(UUID transactionId,UUID caseId,UUID customerId,
                                  CreateTransactionRequest request,FeatureContext context) {
        var candidates=jdbc.query("""
                SELECT analyst_id,specialties::text,regions::text,active_case_count,performance,status,locked,last_assigned_at
                  FROM staff_projection WHERE role='ANALYST' AND status='ACTIVE' AND NOT locked
                 ORDER BY analyst_id
                """,(rs,row)->new AnalystCandidate(rs.getObject(1,UUID.class),strings(rs.getString(2)),strings(rs.getString(3)),
                rs.getInt(4),nullableDouble(rs,5),rs.getString(6),rs.getBoolean(7),instant(rs,8)));
        var features=new AiFeatures(customerId,request.city(),region(request.city()),request.countryCode(),
                request.transactionType(),request.amount(),request.occurredAt().atZone(ZoneOffset.UTC).getHour(),
                context.newDevice(),context.newRecipient(),context.frequency1h(),context.frequency24h(),context.deviation());
        try {
            String aiRequest=write(new AiScoreRequest(transactionId,caseId,features,candidates));
            String response=ai.post().uri("/internal/v1/score").header("X-Internal-Token",aiToken)
                    .contentType(MediaType.APPLICATION_JSON).body(aiRequest)
                    .retrieve().body(String.class);
            JsonNode data=json.readTree(response).path("data");
            if(data.isMissingNode()||!data.hasNonNull("prediction_id")) throw new IllegalStateException("malformed AI response");
            List<RankedCandidate> ranked=new ArrayList<>();
            for(JsonNode item:data.path("ranked_candidates")) ranked.add(new RankedCandidate(
                    UUID.fromString(item.path("analyst_id").asText()),item.path("score").asDouble(),
                    item.path("expertise_match").asDouble(),item.path("availability").asDouble(),
                    item.path("performance").asDouble(),item.path("region_match").asBoolean()));
            return new AiScoreResponse(UUID.fromString(data.path("prediction_id").asText()),
                    data.path("model_version").asText(),data.path("feature_schema_version").asText(),
                    data.path("risk_score").asDouble(),data.path("risk_level").asText(),
                    data.path("decision").asText(),data.path("fraud_type").asText(),
                    strings(data.path("reason_codes")),ranked);
        } catch (RuntimeException error) { throw new IllegalStateException("AI unavailable",error); }
    }

    private UUID reserve(List<RankedCandidate> ranked) {
        for(var candidate:ranked) {
            int changed=jdbc.update("""
                    UPDATE staff_projection SET active_case_count=active_case_count+1,last_assigned_at=now(),updated_at=now()
                     WHERE analyst_id=? AND status='ACTIVE' AND NOT locked AND active_case_count<10
                    """,candidate.analystId());
            if(changed==1)return candidate.analystId();
        }
        return null;
    }

    private FeatureContext features(UUID customerId,CreateTransactionRequest request) {
        Integer hour=jdbc.queryForObject("SELECT count(*) FROM transactions WHERE customer_id=? AND occurred_at>=?-interval '1 hour'",Integer.class,customerId,db(request.occurredAt()));
        Integer day=jdbc.queryForObject("SELECT count(*) FROM transactions WHERE customer_id=? AND occurred_at>=?-interval '24 hours'",Integer.class,customerId,db(request.occurredAt()));
        Integer device=jdbc.queryForObject("SELECT count(*) FROM transactions WHERE customer_id=? AND source_device=?",Integer.class,customerId,request.sourceDevice());
        Integer recipient=jdbc.queryForObject("SELECT count(*) FROM transactions WHERE customer_id=? AND recipient=?",Integer.class,customerId,request.recipient());
        BigDecimal average=jdbc.queryForObject("SELECT COALESCE(avg(amount),0) FROM transactions WHERE customer_id=?",BigDecimal.class,customerId);
        double deviation=average==null||average.signum()==0?0:request.amount().divide(average,4,RoundingMode.HALF_UP).doubleValue();
        return new FeatureContext(device==null||device==0,recipient==null||recipient==0,hour==null?0:hour,day==null?0:day,Math.min(deviation,100));
    }

    @Transactional(readOnly=true)
    public PageView<TransactionView> transactions(RequestPrincipal principal,int page,int size) {
        rls.apply(principal.userId(),principal.role()); int safeSize=Math.max(1,Math.min(size,100)),safePage=Math.max(page,0);
        Long total=jdbc.queryForObject("SELECT count(*) FROM transactions",Long.class);
        var items=jdbc.query(TRANSACTION_SELECT+" ORDER BY t.created_at DESC LIMIT ? OFFSET ?",this::mapTransaction,safeSize,safePage*safeSize);
        return new PageView<>(items,safePage,safeSize,total==null?0:total);
    }

    @Transactional(readOnly=true)
    public TransactionView transaction(RequestPrincipal principal,UUID id) {
        rls.apply(principal.userId(),principal.role()); return transaction(id);
    }
    private TransactionView transaction(UUID id) {
        var values=jdbc.query(TRANSACTION_SELECT+" WHERE t.id=?",this::mapTransaction,id);
        if(values.isEmpty())throw new NoSuchElementException(); return values.getFirst();
    }

    @Transactional(readOnly=true)
    public PageView<RiskCaseView> cases(RequestPrincipal principal,int page,int size) {
        rls.apply(principal.userId(),principal.role()); int safeSize=Math.max(1,Math.min(size,100)),safePage=Math.max(page,0);
        Long total=jdbc.queryForObject("SELECT count(*) FROM risk_cases",Long.class);
        var items=jdbc.query(CASE_SELECT+" ORDER BY CASE c.risk_level WHEN 'KRITIK' THEN 0 WHEN 'YUKSEK' THEN 1 " +
                "WHEN 'ORTA' THEN 2 WHEN 'DUSUK' THEN 3 ELSE 4 END,c.due_at LIMIT ? OFFSET ?",this::mapCase,safeSize,safePage*safeSize);
        return new PageView<>(items,safePage,safeSize,total==null?0:total);
    }

    @Transactional(readOnly=true)
    public RiskCaseView riskCase(RequestPrincipal principal,UUID id) {
        rls.apply(principal.userId(),principal.role()); return riskCase(id);
    }
    private RiskCaseView riskCase(UUID id) {
        var values=jdbc.query(CASE_SELECT+" WHERE c.id=?",this::mapCase,id);
        if(values.isEmpty())throw new NoSuchElementException(); return values.getFirst();
    }

    @Transactional
    public RiskCaseView startReview(RequestPrincipal principal,UUID id,long version,UUID requestId) {
        rls.service(); CaseRow row=locked(id); authorizeAnalyst(principal,row); checkVersion(row,version);
        return transition(principal,row,"INCELENIYOR","review started",requestId,true);
    }

    @Transactional
    public RiskCaseView requestVerification(RequestPrincipal principal,UUID id,long version,UUID requestId) {
        rls.service(); CaseRow row=locked(id); authorizeAnalyst(principal,row); checkVersion(row,version);
        CaseRules.requireTransition(row.status(),"MUSTERI_DOGRULAMA");
        jdbc.update("UPDATE risk_cases SET status='MUSTERI_DOGRULAMA',customer_verification='PENDING',version=version+1,updated_at=now() WHERE id=?",id);
        history(id,row.status(),"MUSTERI_DOGRULAMA",principal,"customer verification requested");
        UUID event=outbox.enqueue("case.customer-verification-requested",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"customer_id",row.customerId()));
        outbox.enqueue("case.status-changed",id,row.version()+1,requestId,event,Map.of(
                "case_id",id,"from_status",row.status(),"to_status","MUSTERI_DOGRULAMA"));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Müşteri doğrulaması bekleniyor."); return riskCase(id);
    }

    @Transactional
    public RiskCaseView verify(RequestPrincipal principal,UUID id,String response,UUID requestId) {
        rls.service(); CaseRow row=locked(id);
        if(!"CUSTOMER".equals(principal.role())||!row.customerId().equals(principal.userId()))throw forbidden();
        if(!"MUSTERI_DOGRULAMA".equals(row.status()))throw DomainViolation.invalidState("Vaka müşteri doğrulaması beklemiyor.");
        double effective=row.score()==null?0.5:row.score(); String hold=row.holdStatus();
        if("CUSTOMER_DENIED".equals(response)){effective=Math.min(1,effective+0.2);if(effective>0.9)hold="TEMPORARY_BLOCK";}
        jdbc.update("UPDATE risk_cases SET status='INCELENIYOR',customer_verification=?,effective_score=?,hold_status=?,version=version+1,updated_at=now() WHERE id=?",
                response,effective,hold,id);
        history(id,row.status(),"INCELENIYOR",principal,"customer responded");
        UUID event=outbox.enqueue("case.customer-verification-responded",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"customer_id",principal.userId(),"response",response,"effective_score",effective));
        outbox.enqueue("case.status-changed",id,row.version()+1,requestId,event,Map.of(
                "case_id",id,"from_status",row.status(),"to_status","INCELENIYOR"));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Müşteri doğrulaması yanıtlandı."); return riskCase(id);
    }

    @Transactional
    public RiskCaseView decision(RequestPrincipal principal,UUID id,DecisionRequest request,UUID requestId) {
        rls.service(); CaseRow row=locked(id); authorizeAnalyst(principal,row); checkVersion(row,request.version());
        CaseRules.requireTransition(row.status(),request.decision()); Instant decided=Instant.now(clock);
        jdbc.update("UPDATE risk_cases SET status=?,decided_at=?,hold_status=?,queue_reason=NULL,version=version+1,updated_at=now() WHERE id=?",
                request.decision(),db(decided),"BLOKLANDI".equals(request.decision())?"PERMANENT_BLOCK":null,id);
        jdbc.update("INSERT INTO case_notes(case_id,author_id,note) VALUES (?,?,?)",id,principal.userId(),request.note());
        if(row.analystId()!=null)jdbc.update("UPDATE staff_projection SET active_case_count=GREATEST(active_case_count-1,0),updated_at=now() WHERE analyst_id=?",row.analystId());
        history(id,row.status(),request.decision(),principal,request.note());
        boolean within=!decided.isAfter(row.dueAt());
        UUID event=outbox.enqueue("case.decision-recorded",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"analyst_id",row.analystId(),"fraud_type",row.fraudType(),
                "decision",request.decision(),"decided_at",decided,"within_sla",within));
        outbox.enqueue("case.status-changed",id,row.version()+1,requestId,event,Map.of(
                "case_id",id,"from_status",row.status(),"to_status",request.decision()));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Vaka karara bağlandı."); return riskCase(id);
    }

    @Transactional
    public RiskCaseView overrideFraud(RequestPrincipal principal,UUID id,FraudTypeRequest request,UUID requestId) {
        rls.service(); CaseRow row=locked(id); authorizeAnalyst(principal,row); checkVersion(row,request.version());
        if(!"INCELENIYOR".equals(row.status()))throw DomainViolation.invalidState("Tür yalnız inceleme sırasında değiştirilebilir.");
        jdbc.update("UPDATE risk_cases SET fraud_type=?,version=version+1,updated_at=now() WHERE id=?",request.fraudType(),id);
        UUID event=outbox.enqueue("case.fraud-type-overridden",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"prediction_id",row.predictionId()==null?"":row.predictionId(),
                "previous_type",row.fraudType(),"effective_type",request.fraudType(),"reason",request.reason(),
                "actor_id",principal.userId()));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Vaka türü güncellendi."); return riskCase(id);
    }

    @Transactional
    public RiskCaseView overrideRisk(RequestPrincipal principal,UUID id,RiskLevelRequest request,UUID requestId) {
        if(!"SUPERVISOR".equals(principal.role()))throw forbidden(); rls.service();
        CaseRow row=locked(id);checkVersion(row,request.version()); Instant due=CaseRules.dueAt(request.riskLevel(),row.createdAt());
        jdbc.update("UPDATE risk_cases SET risk_level=?,due_at=?,version=version+1,updated_at=now() WHERE id=?",request.riskLevel(),db(due),id);
        UUID event=outbox.enqueue("case.risk-level-overridden",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"previous_level",row.riskLevel(),"effective_level",request.riskLevel(),"reason",request.reason()));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Risk seviyesi güncellendi.");return riskCase(id);
    }

    @Transactional
    public RiskCaseView assign(RequestPrincipal principal,UUID id,AssignmentRequest request,UUID requestId) {
        if(!"SUPERVISOR".equals(principal.role()))throw forbidden();rls.service();CaseRow row=locked(id);checkVersion(row,request.version());
        if(!List.of("YENI","ATANDI").contains(row.status()))throw DomainViolation.invalidState("Bu vaka atanamaz.");
        Integer count=jdbc.queryForObject("SELECT active_case_count FROM staff_projection WHERE analyst_id=? AND status='ACTIVE' AND NOT locked",Integer.class,request.analystId());
        if(count==null||(!request.overrideCapacity()&&count>=10))throw new DomainViolation(HttpStatus.CONFLICT,"ANALYST_CAPACITY_FULL","Analist kapasitesi dolu.");
        if(row.analystId()!=null&&!row.analystId().equals(request.analystId()))jdbc.update("UPDATE staff_projection SET active_case_count=GREATEST(active_case_count-1,0) WHERE analyst_id=?",row.analystId());
        if(!request.analystId().equals(row.analystId()))jdbc.update("UPDATE staff_projection SET active_case_count=active_case_count+1,last_assigned_at=now() WHERE analyst_id=?",request.analystId());
        jdbc.update("UPDATE risk_cases SET assigned_analyst_id=?,status='ATANDI',queue_reason=NULL,version=version+1,updated_at=now() WHERE id=?",request.analystId(),id);
        history(id,row.status(),"ATANDI",principal,request.reason());
        UUID event=outbox.enqueue("case.assigned",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"analyst_id",request.analystId(),"assignment_source","SUPERVISOR","reason",request.reason()));
        notifyAfterCommit(event,row.customerId(),request.analystId(),id,"Vaka analiste atandı.");return riskCase(id);
    }

    @Transactional
    public RiskCaseView feedback(RequestPrincipal principal,UUID id,int score,UUID requestId) {
        if(!"CUSTOMER".equals(principal.role()))throw forbidden();rls.service();CaseRow row=locked(id);
        if(!row.customerId().equals(principal.userId()))throw forbidden();
        if(!"KAPANDI".equals(row.status()))throw DomainViolation.invalidState("Geri bildirim yalnız kapanmış vakaya verilebilir.");
        jdbc.update("INSERT INTO case_feedback(case_id,customer_id,score) VALUES (?,?,?)",id,principal.userId(),score);
        UUID event=outbox.enqueue("case.feedback-submitted",id,row.version(),requestId,null,Map.of(
                "case_id",id,"customer_id",principal.userId(),"score",score));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Geri bildiriminiz kaydedildi.");return riskCase(id);
    }

    @Transactional
    public RiskCaseView groundTruth(RequestPrincipal principal,UUID id,GroundTruthRequest request,UUID requestId) {
        if(!"SUPERVISOR".equals(principal.role()))throw forbidden();rls.service();CaseRow row=locked(id);checkVersion(row,request.version());
        jdbc.update("UPDATE risk_cases SET ground_truth=?,ground_truth_fraud_type=?,version=version+1,updated_at=now() WHERE id=?",request.truth(),request.fraudType(),id);
        UUID event=outbox.enqueue("case.ground-truth-set",id,row.version()+1,requestId,null,Map.of(
                "case_id",id,"prediction_id",row.predictionId()==null?"":row.predictionId(),"truth",request.truth(),
                "fraud_type",request.fraudType()==null?"":request.fraudType()));
        notifyAfterCommit(event,row.customerId(),row.analystId(),id,"Doğrulanmış sonuç kaydedildi.");return riskCase(id);
    }

    private RiskCaseView transition(RequestPrincipal principal,CaseRow row,String next,String reason,UUID requestId,boolean start) {
        CaseRules.requireTransition(row.status(),next);
        jdbc.update("UPDATE risk_cases SET status=?,review_started_at=CASE WHEN ? THEN COALESCE(review_started_at,now()) ELSE review_started_at END,version=version+1,updated_at=now() WHERE id=?",next,start,row.id());
        history(row.id(),row.status(),next,principal,reason);
        UUID event=outbox.enqueue("case.status-changed",row.id(),row.version()+1,requestId,null,Map.of(
                "case_id",row.id(),"from_status",row.status(),"to_status",next));
        notifyAfterCommit(event,row.customerId(),row.analystId(),row.id(),"Vaka durumu güncellendi.");return riskCase(row.id());
    }

    @Transactional(readOnly=true)
    public OperationsDashboard dashboard(RequestPrincipal principal) {
        if(!List.of("SUPERVISOR","ADMIN").contains(principal.role()))throw forbidden();rls.apply(principal.userId(),principal.role());
        var fraud=counts("SELECT fraud_type,count(*) FROM risk_cases GROUP BY fraud_type ORDER BY fraud_type");
        var risk=counts("SELECT risk_level,count(*) FROM risk_cases GROUP BY risk_level ORDER BY risk_level");
        var trend=jdbc.query("""
                SELECT date_trunc('day',created_at) bucket,risk_level,count(*) value FROM risk_cases
                 WHERE created_at>=now()-interval '7 days' GROUP BY bucket,risk_level ORDER BY bucket,risk_level
                """,(rs,row)->new RiskTrend(instant(rs,1),rs.getString(2),rs.getLong(3)));
        Map<String,Object> sla=jdbc.queryForMap("""
                SELECT count(*) FILTER(WHERE decided_at IS NOT NULL) terminal,
                       count(*) FILTER(WHERE decided_at IS NOT NULL AND decided_at<=due_at) compliant,
                       count(*) FILTER(WHERE decided_at IS NULL AND due_at<now()) active_breaches
                  FROM risk_cases
                """);
        long terminal=num(sla,"terminal"),compliant=num(sla,"compliant");
        Map<String,Object> accuracy=jdbc.queryForMap("""
                SELECT count(*) FILTER(WHERE ground_truth IS NOT NULL) samples,
                       count(*) FILTER(WHERE (ground_truth='FRAUD' AND status='BLOKLANDI') OR
                         (ground_truth='LEGITIMATE' AND status IN ('ONAYLANDI','KAPANDI'))) correct,
                       count(*) FILTER(WHERE ground_truth='LEGITIMATE') legitimate,
                       count(*) FILTER(WHERE ground_truth='LEGITIMATE' AND status='BLOKLANDI') false_positive
                  FROM risk_cases
                """);
        long samples=num(accuracy,"samples"),legit=num(accuracy,"legitimate");
        var categories=jdbc.query("""
                SELECT ground_truth_fraud_type,count(*) samples,
                       count(*) FILTER(WHERE fraud_type=ground_truth_fraud_type) correct
                  FROM risk_cases WHERE ground_truth='FRAUD' AND ground_truth_fraud_type IS NOT NULL
                 GROUP BY ground_truth_fraud_type ORDER BY ground_truth_fraud_type
                """,(rs,row)->new CategoryAccuracy(rs.getString(1),percent(rs.getLong(3),rs.getLong(2)),rs.getLong(2)));
        var analysts=jdbc.query("""
                SELECT s.analyst_id,s.display_name,count(c.id) FILTER(WHERE c.decided_at IS NOT NULL) decisions,
                       COALESCE(avg(extract(epoch FROM(c.decided_at-c.review_started_at))/60)
                         FILTER(WHERE c.decided_at IS NOT NULL AND c.review_started_at IS NOT NULL),0) avg_minutes,
                       count(c.id) FILTER(WHERE c.ground_truth IS NOT NULL) samples,
                       count(c.id) FILTER(WHERE (c.ground_truth='FRAUD' AND c.status='BLOKLANDI') OR
                         (c.ground_truth='LEGITIMATE' AND c.status IN ('ONAYLANDI','KAPANDI'))) correct
                  FROM staff_projection s LEFT JOIN risk_cases c ON c.assigned_analyst_id=s.analyst_id
                 WHERE s.role='ANALYST' GROUP BY s.analyst_id,s.display_name ORDER BY decisions DESC
                """,(rs,row)->new AnalystPerformance(rs.getObject(1,UUID.class),rs.getString(2),rs.getLong(3),
                rs.getDouble(4),rs.getLong(5)==0?null:percent(rs.getLong(6),rs.getLong(5))));
        var manual=jdbc.query(CASE_SELECT+" WHERE c.assigned_analyst_id IS NULL AND c.status='YENI' ORDER BY c.due_at LIMIT 50",this::mapCase);
        return new OperationsDashboard(Instant.now(clock),false,List.of(),fraud,risk,trend,
                terminal==0?100:percent(compliant,terminal),num(sla,"active_breaches"),
                samples==0?null:percent(num(accuracy,"correct"),samples),legit==0?null:percent(num(accuracy,"false_positive"),legit),
                categories,analysts,manual);
    }

    private List<NamedCount> counts(String sql){return jdbc.query(sql,(rs,row)->new NamedCount(rs.getString(1),rs.getLong(2)));}

    @Scheduled(fixedDelayString="${fraudcell.sla.poll-ms:60000}")
    @Transactional public void markSlaBreaches(){
        rls.service(); var rows=jdbc.query("SELECT id,customer_id,assigned_analyst_id,risk_level,version FROM risk_cases " +
                "WHERE decided_at IS NULL AND due_at<now() AND sla_breached_at IS NULL FOR UPDATE SKIP LOCKED LIMIT 100",
                (rs,row)->new Breach(rs.getObject(1,UUID.class),rs.getObject(2,UUID.class),rs.getObject(3,UUID.class),rs.getString(4),rs.getLong(5)));
        for(var value:rows){jdbc.update("UPDATE risk_cases SET sla_breached_at=now(),version=version+1 WHERE id=?",value.id());
            if(value.analyst()!=null)outbox.enqueue("case.sla-breached",value.id(),value.version()+1,UUID.randomUUID(),null,Map.of(
                    "case_id",value.id(),"analyst_id",value.analyst(),"risk_level",value.risk()));}
    }

    @Scheduled(fixedDelayString="${fraudcell.closure.poll-ms:60000}")
    @Transactional public void closeApproved(){
        rls.service(); var ids=jdbc.query("SELECT id FROM risk_cases WHERE status='ONAYLANDI' AND decided_at<now()-interval '48 hours' FOR UPDATE SKIP LOCKED LIMIT 100",
                (rs,row)->rs.getObject(1,UUID.class));
        for(UUID id:ids){CaseRow row=locked(id);jdbc.update("UPDATE risk_cases SET status='KAPANDI',version=version+1,updated_at=now() WHERE id=?",id);
            history(id,"ONAYLANDI","KAPANDI",new RequestPrincipal(new UUID(0,0),"SERVICE"),"automatic closure");
            outbox.enqueue("case.closed",id,row.version()+1,UUID.randomUUID(),null,Map.of("case_id",id));}
    }

    private CaseRow locked(UUID id){var rows=jdbc.query("SELECT id,customer_id,assigned_analyst_id,status,risk_level,fraud_type,raw_ai_score,hold_status,due_at,prediction_id,version,created_at FROM risk_cases WHERE id=? FOR UPDATE",
            (rs,row)->new CaseRow(rs.getObject(1,UUID.class),rs.getObject(2,UUID.class),rs.getObject(3,UUID.class),rs.getString(4),rs.getString(5),rs.getString(6),nullableDouble(rs,7),rs.getString(8),instant(rs,9),rs.getObject(10,UUID.class),rs.getLong(11),instant(rs,12)),id);
        if(rows.isEmpty())throw new NoSuchElementException();return rows.getFirst();}
    private void authorizeAnalyst(RequestPrincipal principal,CaseRow row){if("SUPERVISOR".equals(principal.role()))return;if(!"ANALYST".equals(principal.role())||!principal.userId().equals(row.analystId()))throw forbidden();}
    private static void checkVersion(CaseRow row,long expected){if(row.version()!=expected)throw new DomainViolation(HttpStatus.CONFLICT,"STALE_CASE_VERSION","Vaka başka bir işlemle güncellendi.");}
    private void history(UUID id,String from,String to,RequestPrincipal actor,String reason){jdbc.update("INSERT INTO case_status_history(case_id,from_status,to_status,actor_id,actor_role,reason) VALUES (?,?,?,?,?,?)",id,from,to,actor.userId(),actor.role(),reason);}
    private void notifyAfterCommit(UUID event,UUID customer,UUID analyst,UUID caseId,String message){TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){@Override public void afterCommit(){sse.publish(event,customer,analyst,Map.of("type","case.updated","message",message,"case_id",caseId));}});}

    private TransactionView mapTransaction(ResultSet rs,int row) throws SQLException{return new TransactionView(
            rs.getObject("id",UUID.class),rs.getString("transaction_number"),rs.getBigDecimal("amount").toPlainString(),
            rs.getString("currency"),rs.getString("transaction_type"),rs.getString("recipient"),rs.getString("source_device"),
            rs.getString("city"),rs.getString("country_code"),instant(rs,"occurred_at"),rs.getString("prediction_status"),
            nullableDouble(rs,"raw_ai_score"),rs.getString("risk_level"),rs.getString("fraud_type"),rs.getString("ai_decision"),
            rs.getString("model_version"),strings(rs.getString("reason_codes")),rs.getObject("case_id",UUID.class),rs.getString("case_status"));}
    private RiskCaseView mapCase(ResultSet rs,int row) throws SQLException{
        TransactionView transaction=new TransactionView(rs.getObject("transaction_id",UUID.class),rs.getString("transaction_number"),
                rs.getBigDecimal("amount").toPlainString(),rs.getString("currency"),rs.getString("transaction_type"),rs.getString("recipient"),
                rs.getString("source_device"),rs.getString("city"),rs.getString("country_code"),instant(rs,"occurred_at"),
                rs.getString("prediction_status"),nullableDouble(rs,"raw_ai_score"),rs.getString("risk_level"),rs.getString("fraud_type"),
                rs.getString("ai_decision"),rs.getString("model_version"),strings(rs.getString("reason_codes")),rs.getObject("id",UUID.class),rs.getString("status"));
        return new RiskCaseView(rs.getObject("id",UUID.class),transaction,rs.getObject("customer_id",UUID.class),rs.getObject("assigned_analyst_id",UUID.class),
                rs.getString("status"),rs.getString("risk_level"),rs.getString("fraud_type"),nullableDouble(rs,"raw_ai_score"),nullableDouble(rs,"effective_score"),
                rs.getString("hold_status"),rs.getString("queue_reason"),instant(rs,"due_at"),instant(rs,"created_at"),rs.getLong("version"),rs.getString("customer_verification"));}

    private String write(Object value){try{return json.writeValueAsString(value);}catch(Exception error){throw new IllegalStateException(error);}}
    private List<String> strings(String value){try{JsonNode node=json.readTree(value);return strings(node);}catch(Exception error){return List.of();}}
    private static List<String> strings(JsonNode node){var result=new ArrayList<String>();if(node!=null&&node.isArray())node.forEach(item->result.add(item.asText()));return List.copyOf(result);}
    private static Double nullableDouble(ResultSet rs,int index)throws SQLException{BigDecimal value=rs.getObject(index,BigDecimal.class);return value==null?null:value.doubleValue();}
    private static Double nullableDouble(ResultSet rs,String name)throws SQLException{BigDecimal value=rs.getObject(name,BigDecimal.class);return value==null?null:value.doubleValue();}
    private static OffsetDateTime db(Instant value){return value==null?null:value.atOffset(ZoneOffset.UTC);}
    private static Instant instant(ResultSet rs,int index)throws SQLException{OffsetDateTime value=rs.getObject(index,OffsetDateTime.class);return value==null?null:value.toInstant();}
    private static Instant instant(ResultSet rs,String name)throws SQLException{OffsetDateTime value=rs.getObject(name,OffsetDateTime.class);return value==null?null:value.toInstant();}
    private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException(error);}}
    private static String region(String city){String value=city.toUpperCase(Locale.ROOT);if(value.contains("IZMIR")||value.contains("MANISA"))return "EGE";if(value.contains("ANKARA")||value.contains("KONYA"))return "IC_ANADOLU";if(value.contains("ANTALYA")||value.contains("ADANA"))return "AKDENIZ";if(value.contains("SAMSUN")||value.contains("TRABZON"))return "KARADENIZ";if(value.contains("ERZURUM")||value.contains("VAN"))return "DOGU_ANADOLU";if(value.contains("GAZIANTEP")||value.contains("DIYARBAKIR"))return "GUNEYDOGU_ANADOLU";return "MARMARA";}
    private static long num(Map<String,Object> map,String key){return ((Number)map.get(key)).longValue();}
    private static double percent(long part,long total){return total==0?0:part*100.0/total;}
    private static DomainViolation forbidden(){return new DomainViolation(HttpStatus.FORBIDDEN,"FORBIDDEN","Bu işlem için yetkiniz yok.");}

    private record Existing(String hash,UUID transactionId){}
    private record FeatureContext(boolean newDevice,boolean newRecipient,int frequency1h,int frequency24h,double deviation){}
    private record CaseRow(UUID id,UUID customerId,UUID analystId,String status,String riskLevel,String fraudType,
                           Double score,String holdStatus,Instant dueAt,UUID predictionId,long version,Instant createdAt){}
    private record Breach(UUID id,UUID customer,UUID analyst,String risk,long version){}
}
