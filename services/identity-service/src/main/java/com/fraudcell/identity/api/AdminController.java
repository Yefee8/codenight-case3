package com.fraudcell.identity.api;

import com.fraudcell.identity.api.ApiSupport.ApiEnvelope;
import com.fraudcell.identity.application.AdminService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AdminController {
    private final AdminService service;

    public AdminController(AdminService service) {
        this.service = service;
    }

    @PostMapping("/admin/staff")
    ApiEnvelope<AdminDtos.StaffView> create(@Valid @RequestBody AdminDtos.CreateStaffRequest body,
                                            Authentication authentication, HttpServletRequest request) {
        return ApiEnvelope.ok(service.create(body, actorId(authentication), ApiSupport.requestId(request), request), request);
    }

    @PatchMapping("/admin/staff/{staffId}")
    ApiEnvelope<AdminDtos.StaffView> update(@PathVariable UUID staffId,
                                            @Valid @RequestBody AdminDtos.UpdateStaffRequest body,
                                            Authentication authentication, HttpServletRequest request) {
        return ApiEnvelope.ok(service.update(staffId, body, actorId(authentication),
                ApiSupport.requestId(request), request), request);
    }

    @GetMapping("/staff")
    ApiEnvelope<AdminDtos.Page<AdminDtos.StaffView>> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            Authentication authentication, HttpServletRequest request) {
        validatePage(page, size);
        return ApiEnvelope.ok(service.list(page, size, actorId(authentication), role(authentication)), request);
    }

    @GetMapping("/admin/audit-logs")
    ApiEnvelope<AdminDtos.Page<AdminDtos.AuditView>> audit(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            Authentication authentication, HttpServletRequest request) {
        validatePage(page, size);
        return ApiEnvelope.ok(service.audit(page, size, actorId(authentication)), request);
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ApiSupport.DomainException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                    "INVALID_PAGE", "page >= 0 ve size 1..100 olmalıdır.");
        }
    }

    private static UUID actorId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }

    private static String role(Authentication authentication) {
        if (authentication instanceof JwtAuthenticationToken token) {
            return token.getToken().getClaimAsString("role");
        }
        return "SYSTEM";
    }
}
