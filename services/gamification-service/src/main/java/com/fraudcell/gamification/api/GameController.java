package com.fraudcell.gamification.api;

import com.fraudcell.gamification.application.GameQueryService;
import com.fraudcell.gamification.application.GameSseHub;
import com.fraudcell.gamification.security.RequestPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1/game")
public class GameController {
    private final GameQueryService queries;
    private final GameSseHub sseHub;

    public GameController(GameQueryService queries, GameSseHub sseHub) {
        this.queries = queries;
        this.sseHub = sseHub;
    }

    @GetMapping("/profile/me")
    ApiEnvelope<GameDtos.ProfileView> myProfile(Authentication authentication, HttpServletRequest request) {
        var principal = RequestPrincipal.from(authentication);
        return ApiEnvelope.success(queries.profile(principal, principal.userId()), RequestIdFilter.current(request));
    }

    @GetMapping("/profiles/{analystId}")
    ApiEnvelope<GameDtos.ProfileView> profile(
            @PathVariable UUID analystId, Authentication authentication, HttpServletRequest request) {
        return ApiEnvelope.success(
                queries.profile(RequestPrincipal.from(authentication), analystId), RequestIdFilter.current(request));
    }

    @GetMapping("/leaderboard")
    ApiEnvelope<List<GameDtos.LeaderboardEntry>> leaderboard(
            @RequestParam(defaultValue = "daily") String period,
            Authentication authentication,
            HttpServletRequest request) {
        return ApiEnvelope.success(
                queries.leaderboard(RequestPrincipal.from(authentication), period).entries(),
                RequestIdFilter.current(request));
    }

    @GetMapping("/badges")
    ApiEnvelope<List<GameDtos.BadgeView>> badges(Authentication authentication, HttpServletRequest request) {
        return ApiEnvelope.success(
                queries.badges(RequestPrincipal.from(authentication)), RequestIdFilter.current(request));
    }

    @GetMapping(path = "/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    SseEmitter notifications(Authentication authentication) {
        return sseHub.subscribe(RequestPrincipal.from(authentication).userId());
    }
}
