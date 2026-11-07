package com.cgtcalculator.platform.auth;

import java.time.Clock;
import java.time.Duration;

import org.springframework.stereotype.Component;

import com.cgtcalculator.platform.auth.RateLimiter.Decision;
import com.cgtcalculator.platform.web.ApiExceptionHandler.TooManyRequestsException;

/** The limits of {@link LimitProperties}: each check counts an attempt and refuses it past the limit. */
@Component
public class RequestLimits {

    private final RateLimiter logins;
    private final RateLimiter signUps;
    private final RateLimiter resetRequests;
    private final RateLimiter linksPerEmail;

    public RequestLimits(LimitProperties limits, Clock clock) {
        logins = new RateLimiter(limits.loginsPerAddressPerMinute(), Duration.ofMinutes(1), clock);
        signUps = new RateLimiter(limits.signUpsPerAddressPerHour(), Duration.ofHours(1), clock);
        resetRequests = new RateLimiter(limits.resetRequestsPerAddressPerHour(), Duration.ofHours(1), clock);
        linksPerEmail = new RateLimiter(limits.emailsPerAddressPerHour(), Duration.ofHours(1), clock);
    }

    public Decision login(String address) {
        return logins.acquire(address);
    }

    public void signUp(String address) {
        require(signUps.acquire(address), "Too many sign-ups from your network.");
    }

    public void resetRequest(String address, String email) {
        require(resetRequests.acquire(address), "Too many requests.");
        require(linksPerEmail.acquire("reset|" + LoginThrottle.normalize(email)), "Too many requests.");
    }

    public void verificationRequest(String email) {
        require(linksPerEmail.acquire("verify|" + LoginThrottle.normalize(email)), "Too many requests.");
    }

    /** Refuses the request (HTTP 429) unless the decision allows it. */
    public static void require(Decision decision, String message) {
        if (!decision.allowed()) {
            throw new TooManyRequestsException(message, decision.retryAfterSeconds());
        }
    }
}
