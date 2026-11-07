package com.cgtcalculator.platform.auth;

import java.time.Clock;
import java.time.Duration;
import java.util.Locale;

import org.springframework.stereotype.Component;

/**
 * Slows down password guessing without letting anyone lock a user out.
 * <ul>
 * <li>Per email and address: 5 failed logins are free, then each attempt waits 30 s, 1 min, 2 min ... up to
 * 15 minutes. Someone guessing elsewhere doesn't slow down the real user, who logs in from another address.</li>
 * <li>Per email from all addresses: past 50 failures in an hour (guessing from many addresses), attempts are
 * spaced 30 s to 1 minute apart, which slows the guessing a lot and the real user only a little.</li>
 * </ul>
 * The number of logins per address is limited separately ({@link RequestLimits}). Kept in memory, so a restart
 * clears it.
 */
@Component
public class LoginThrottle {

    static final int FREE_FAILURES = 5;
    static final int FREE_FAILURES_PER_ACCOUNT = 50;

    private final FailureBackoff perAddress;
    private final FailureBackoff perAccount;

    public LoginThrottle(Clock clock) {
        perAddress = new FailureBackoff(FREE_FAILURES, Duration.ofSeconds(30), Duration.ofMinutes(15), Duration.ofHours(1), clock);
        perAccount = new FailureBackoff(FREE_FAILURES_PER_ACCOUNT, Duration.ofSeconds(30), Duration.ofMinutes(1), Duration.ofHours(1), clock);
    }

    /** Seconds until the next attempt is allowed, or 0 when it is allowed now. */
    public long secondsLocked(String email, String address) {
        return Math.max(perAddress.secondsToWait(key(email, address)), perAccount.secondsToWait(normalize(email)));
    }

    /** @return whether this failure starts the waiting for this email and address */
    public boolean failed(String email, String address) {
        perAccount.failed(normalize(email));
        return perAddress.failed(key(email, address));
    }

    public void succeeded(String email, String address) {
        perAddress.clear(key(email, address));
        perAccount.clear(normalize(email));
    }

    private static String key(String email, String address) {
        return normalize(email) + "|" + address;
    }

    static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
