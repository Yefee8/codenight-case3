package com.fraudcell.transaction.api;

import static com.fraudcell.transaction.api.TransactionDtos.*;

import com.fraudcell.transaction.application.TransactionFacade;
import com.fraudcell.transaction.application.TransactionSseHub;
import com.fraudcell.transaction.security.RequestPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1")
public class TransactionController {
    private final TransactionFacade service; private final TransactionSseHub sse;
    public TransactionController(TransactionFacade service,TransactionSseHub sse){this.service=service;this.sse=sse;}

    @PostMapping("/transactions")
    ApiEnvelope<TransactionView> create(@Valid @RequestBody CreateTransactionRequest body,
            @RequestHeader("Idempotency-Key") String key,Authentication authentication,HttpServletRequest request){
        UUID requestId=RequestIdFilter.current(request);
        return ApiEnvelope.ok(service.create(RequestPrincipal.from(authentication),body,key,requestId),requestId);
    }
    @GetMapping("/transactions")
    ApiEnvelope<PageView<TransactionView>> transactions(@RequestParam(defaultValue="0") int page,
            @RequestParam(defaultValue="20") int size,Authentication authentication,HttpServletRequest request){
        return ApiEnvelope.ok(service.transactions(RequestPrincipal.from(authentication),page,size),RequestIdFilter.current(request));
    }
    @GetMapping("/transactions/{id}")
    ApiEnvelope<TransactionView> transaction(@PathVariable UUID id,Authentication authentication,HttpServletRequest request){
        return ApiEnvelope.ok(service.transaction(RequestPrincipal.from(authentication),id),RequestIdFilter.current(request));
    }
    @GetMapping("/cases")
    ApiEnvelope<PageView<RiskCaseView>> cases(@RequestParam(defaultValue="0") int page,
            @RequestParam(defaultValue="20") int size,Authentication authentication,HttpServletRequest request){
        return ApiEnvelope.ok(service.cases(RequestPrincipal.from(authentication),page,size),RequestIdFilter.current(request));
    }
    @GetMapping("/cases/{id}")
    ApiEnvelope<RiskCaseView> riskCase(@PathVariable UUID id,Authentication authentication,HttpServletRequest request){
        return ApiEnvelope.ok(service.riskCase(RequestPrincipal.from(authentication),id),RequestIdFilter.current(request));
    }
    @PostMapping("/cases/{id}/actions/start-review")
    ApiEnvelope<RiskCaseView> start(@PathVariable UUID id,@Valid @RequestBody VersionRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.startReview(RequestPrincipal.from(authentication),id,body.version(),rid),rid);}
    @PostMapping("/cases/{id}/actions/request-customer-verification")
    ApiEnvelope<RiskCaseView> requestVerification(@PathVariable UUID id,@Valid @RequestBody VersionRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.requestVerification(RequestPrincipal.from(authentication),id,body.version(),rid),rid);}
    @PostMapping("/cases/{id}/customer-verification")
    ApiEnvelope<RiskCaseView> verify(@PathVariable UUID id,@Valid @RequestBody VerificationRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.verify(RequestPrincipal.from(authentication),id,body.response(),rid),rid);}
    @PostMapping("/cases/{id}/decision")
    ApiEnvelope<RiskCaseView> decision(@PathVariable UUID id,@Valid @RequestBody DecisionRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.decision(RequestPrincipal.from(authentication),id,body,rid),rid);}
    @PatchMapping("/cases/{id}/fraud-type")
    ApiEnvelope<RiskCaseView> fraud(@PathVariable UUID id,@Valid @RequestBody FraudTypeRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.overrideFraud(RequestPrincipal.from(authentication),id,body,rid),rid);}
    @PatchMapping("/cases/{id}/risk-level")
    ApiEnvelope<RiskCaseView> risk(@PathVariable UUID id,@Valid @RequestBody RiskLevelRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.overrideRisk(RequestPrincipal.from(authentication),id,body,rid),rid);}
    @PostMapping("/cases/{id}/assignments")
    ApiEnvelope<RiskCaseView> assign(@PathVariable UUID id,@Valid @RequestBody AssignmentRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.assign(RequestPrincipal.from(authentication),id,body,rid),rid);}
    @PostMapping("/cases/{id}/feedback")
    ApiEnvelope<RiskCaseView> feedback(@PathVariable UUID id,@Valid @RequestBody FeedbackRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.feedback(RequestPrincipal.from(authentication),id,body.score(),rid),rid);}
    @PostMapping("/cases/{id}/ground-truth")
    ApiEnvelope<RiskCaseView> truth(@PathVariable UUID id,@Valid @RequestBody GroundTruthRequest body,
            Authentication authentication,HttpServletRequest request){UUID rid=RequestIdFilter.current(request);return ApiEnvelope.ok(service.groundTruth(RequestPrincipal.from(authentication),id,body,rid),rid);}
    @GetMapping("/dashboard/operations")
    ApiEnvelope<OperationsDashboard> dashboard(Authentication authentication,HttpServletRequest request){return ApiEnvelope.ok(service.dashboard(RequestPrincipal.from(authentication)),RequestIdFilter.current(request));}
    @GetMapping(path="/notifications/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    SseEmitter notifications(Authentication authentication){return sse.subscribe(RequestPrincipal.from(authentication));}
}
