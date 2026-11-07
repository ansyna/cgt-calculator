package com.cgtcalculator.platform.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

class LoginThrottleTest {

    /** A clock the test can move forward. */
    static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-19T10:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void fiveFreeFailuresThenAGrowingWait() {
        MutableClock clock = new MutableClock();
        LoginThrottle throttle = new LoginThrottle(clock);
        for (int i = 0; i < 4; i++) assertThat(throttle.failed("a@example.com", "1.1.1.1")).isFalse();
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();

        // the fifth failure starts the waiting: 30 s, then 1 min, 2 min ...
        assertThat(throttle.failed("A@example.com ", "1.1.1.1")).isTrue();
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(30);
        clock.now = clock.now.plusSeconds(30);
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();
        assertThat(throttle.failed("a@example.com", "1.1.1.1")).isFalse();
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(60);
        clock.now = clock.now.plusSeconds(60);
        throttle.failed("a@example.com", "1.1.1.1");
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(120);

        // up to 15 minutes
        for (int i = 0; i < 10; i++) {
            clock.now = clock.now.plus(Duration.ofMinutes(15));
            throttle.failed("a@example.com", "1.1.1.1");
        }
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(15 * 60);
        // forgotten an hour after the last failure
        clock.now = clock.now.plus(Duration.ofHours(1));
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();
        assertThat(throttle.failed("a@example.com", "1.1.1.1")).isFalse();
    }

    @Test
    void someoneGuessingElsewhereDoesNotLockTheUserOut() {
        LoginThrottle throttle = new LoginThrottle(new MutableClock());
        for (int i = 0; i < 20; i++) throttle.failed("a@example.com", "6.6.6.6");
        assertThat(throttle.secondsLocked("a@example.com", "6.6.6.6")).isPositive();
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();
    }

    @Test
    void guessingFromManyAddressesSlowsTheAccountByAMinuteAtMost() {
        MutableClock clock = new MutableClock();
        LoginThrottle throttle = new LoginThrottle(clock);
        for (int i = 0; i < 49; i++) throttle.failed("a@example.com", "10.0.0." + i);
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();
        throttle.failed("a@example.com", "10.0.1.1");
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(30);
        for (int i = 0; i < 10; i++) throttle.failed("a@example.com", "10.0.2." + i);
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isEqualTo(60);
    }

    @Test
    void successClearsTheCount() {
        LoginThrottle throttle = new LoginThrottle(new MutableClock());
        for (int i = 0; i < 4; i++) throttle.failed("a@example.com", "1.1.1.1");
        throttle.succeeded("a@example.com", "1.1.1.1");
        throttle.failed("a@example.com", "1.1.1.1");
        assertThat(throttle.secondsLocked("a@example.com", "1.1.1.1")).isZero();
    }

    @Test
    void rateLimiterCountsPerWindowAndReportsTheFirstRefusalOnce() {
        MutableClock clock = new MutableClock();
        RateLimiter limiter = new RateLimiter(2, Duration.ofMinutes(1), clock);
        assertThat(limiter.acquire("k").allowed()).isTrue();
        clock.now = clock.now.plusSeconds(20);
        assertThat(limiter.acquire("k").allowed()).isTrue();
        RateLimiter.Decision refused = limiter.acquire("k");
        assertThat(refused.allowed()).isFalse();
        assertThat(refused.firstRefusal()).isTrue();
        assertThat(refused.retryAfterSeconds()).isEqualTo(40);
        assertThat(limiter.acquire("k").firstRefusal()).isFalse();
        assertThat(limiter.acquire("other").allowed()).isTrue();
        clock.now = clock.now.plusSeconds(40);
        assertThat(limiter.acquire("k").allowed()).isTrue();
    }
}
