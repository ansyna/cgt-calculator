package com.cgtcalculator.platform.account;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.cgtcalculator.platform.auth.JwtService;
import com.cgtcalculator.platform.user.User;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Logins: a short-lived access token (JWT, kept in the page's memory) plus a long-lived refresh token in an
 * HttpOnly, SameSite=Strict cookie that page scripts can't read. Each refresh replaces the cookie's token; if a
 * replaced token comes back later it was copied, so every token of that login is revoked.
 */
@Service
public class SessionService {

    public static final String COOKIE = "ss_refresh";
    static final String COOKIE_PATH = "/api/auth";
    /**
     * A replaced token presented again this soon after is not taken for a copy: two tabs refreshing at once, or a
     * refresh whose answer (the new token) didn't reach the browser and is tried again. Long enough for a server
     * waking up on a free instance (2-3 minutes), during which the browser may give up and try again.
     */
    static final Duration CONCURRENT_REFRESH = Duration.ofMinutes(5);

    public record Session(String accessToken, User user) {
    }

    private final RefreshTokenRepository repository;
    private final JwtService jwtService;
    private final ActivityService activity;
    private final AccountProperties properties;
    private final Clock clock;

    public SessionService(RefreshTokenRepository repository, JwtService jwtService, ActivityService activity,
                          AccountProperties properties, Clock clock) {
        this.repository = repository;
        this.jwtService = jwtService;
        this.activity = activity;
        this.properties = properties;
        this.clock = clock;
    }

    /** Logs the user in: sets the refresh cookie and returns an access token. */
    @Transactional
    public String start(User user, HttpServletResponse response) {
        issue(user, UUID.randomUUID().toString(), response);
        return jwtService.issueToken(user);
    }

    // the revocation of a copied login must stick although the request is refused
    @Transactional(noRollbackFor = ResponseStatusException.class)
    public Session refresh(String cookieToken, HttpServletResponse response) {
        RefreshToken current = find(cookieToken);
        Instant now = clock.instant();
        if (current == null || !current.getExpiresAt().isAfter(now)) {
            clearCookie(response);
            throw unauthorized();
        }
        if (current.getRevokedAt() != null) {
            boolean concurrent = current.isRotated() && current.getRevokedAt().isAfter(now.minus(CONCURRENT_REFRESH));
            if (!concurrent) {
                clearCookie(response);
                if (current.isRotated()) {
                    repository.revokeFamily(current.getFamily(), now);
                    activity.record("session.reuse-detected", current.getUser().getEmail(), current.getUser().getEmail(),
                            "A replaced login token was used again: that login was ended everywhere");
                }
                throw unauthorized();
            }
        } else {
            current.rotate(now);
        }
        issue(current.getUser(), current.getFamily(), response);
        return new Session(jwtService.issueToken(current.getUser()), current.getUser());
    }

    /** Logs out this browser; returns the user, or null without a valid cookie. */
    @Transactional
    public User end(String cookieToken, HttpServletResponse response) {
        clearCookie(response);
        RefreshToken current = find(cookieToken);
        if (current == null) {
            return null;
        }
        repository.revokeFamily(current.getFamily(), clock.instant());
        return current.getUser();
    }

    /** Ends all of the user's logins (password reset, account deleted). */
    @Transactional
    public void endAll(User user) {
        repository.revokeAllOf(user, clock.instant());
    }

    @Scheduled(fixedDelayString = "PT6H", initialDelayString = "PT15M")
    @Transactional
    public void deleteExpired() {
        repository.deleteExpiredBefore(clock.instant().minus(Duration.ofDays(1)));
    }

    private void issue(User user, String family, HttpServletResponse response) {
        String token = Tokens.random();
        Instant now = clock.instant();
        Duration lifetime = Duration.ofDays(Math.max(1, properties.refreshDays()));
        repository.save(new RefreshToken(user, Tokens.hash(token), family, now, now.plus(lifetime)));
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(token, lifetime).toString());
    }

    private RefreshToken find(String cookieToken) {
        return cookieToken == null || cookieToken.isBlank() ? null
                : repository.findByTokenHash(Tokens.hash(cookieToken)).orElse(null);
    }

    private void clearCookie(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE, value)
                .httpOnly(true)
                .secure(properties.cookieSecure())
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(maxAge)
                .build();
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Please log in.");
    }
}
