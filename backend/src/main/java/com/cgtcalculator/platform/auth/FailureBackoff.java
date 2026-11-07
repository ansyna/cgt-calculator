package com.cgtcalculator.platform.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Failures with a growing wait: the first {@code free} failures cost nothing, then each further attempt waits
 * {@code base} × 2ⁿ after the last failure, up to {@code max}. A key is forgotten {@code forget} after its last
 * failure. Kept in memory, so a restart clears it.
 */
final class FailureBackoff {

    private record State(int failures, Instant lastFailure) {
    }

    private static final int PRUNE_AT = 10_000;
    private static final int MAX_KEYS = 100_000;

    private final int free;
    private final Duration base;
    private final Duration max;
    private final Duration forget;
    private final Clock clock;
    private final Map<String, State> states = new ConcurrentHashMap<>();

    FailureBackoff(int free, Duration base, Duration max, Duration forget, Clock clock) {
        this.free = free;
        this.base = base;
        this.max = max;
        this.forget = forget;
        this.clock = clock;
    }

    /** Seconds until the key may try again, 0 when it may now. */
    long secondsToWait(String key) {
        State state = live(states.get(key), clock.instant());
        if (state == null || state.failures() < free) return 0;
        Duration remaining = Duration.between(clock.instant(), state.lastFailure().plus(wait(state.failures())));
        return remaining.isNegative() || remaining.isZero() ? 0 : Math.max(1, remaining.toSeconds());
    }

    /** @return whether this failure starts the waiting (worth recording once) */
    boolean failed(String key) {
        Instant now = clock.instant();
        State state = states.compute(key, (k, old) -> {
            State live = live(old, now);
            return new State(live == null ? 1 : live.failures() + 1, now);
        });
        if (states.size() > PRUNE_AT) {
            states.values().removeIf(s -> live(s, now) == null);
            if (states.size() > MAX_KEYS) states.clear();
        }
        return state.failures() == free;
    }

    void clear(String key) {
        states.remove(key);
    }

    private Duration wait(int failures) {
        int doublings = Math.min(failures - free, 20);
        Duration wait = base.multipliedBy(1L << doublings);
        return wait.compareTo(max) > 0 ? max : wait;
    }

    private State live(State state, Instant now) {
        return state != null && now.isBefore(state.lastFailure().plus(forget)) ? state : null;
    }
}
