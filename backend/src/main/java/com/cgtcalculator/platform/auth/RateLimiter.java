package com.cgtcalculator.platform.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most {@code limit} events per key in each fixed window (e.g. 5 sign-ups an hour per address). Kept in memory,
 * so a restart clears it.
 */
public final class RateLimiter {

    /**
     * @param retryAfterSeconds when the next event is allowed (0 when this one is)
     * @param firstRefusal      the first refusal in this window: worth recording once, not on every attempt
     */
    public record Decision(boolean allowed, long retryAfterSeconds, boolean firstRefusal) {

        static final Decision ALLOWED = new Decision(true, 0, false);
    }

    private record Window(Instant start, int count, boolean refused) {
    }

    /** Above this many keys the expired ones are dropped; above {@link #MAX_KEYS} all are (failing open, not running out of memory). */
    private static final int PRUNE_AT = 10_000;
    private static final int MAX_KEYS = 100_000;

    private final int limit;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public RateLimiter(int limit, Duration window, Clock clock) {
        this.limit = limit;
        this.window = window;
        this.clock = clock;
    }

    /** Counts an event for the key, unless the key already used up its window. */
    public Decision acquire(String key) {
        Instant now = clock.instant();
        Decision[] decision = new Decision[1];
        windows.compute(key, (k, old) -> {
            Window live = old != null && isLive(old, now) ? old : new Window(now, 0, false);
            if (live.count() < limit) {
                decision[0] = Decision.ALLOWED;
                return new Window(live.start(), live.count() + 1, false);
            }
            long wait = Math.max(1, Duration.between(now, live.start().plus(window)).toSeconds());
            decision[0] = new Decision(false, wait, !live.refused());
            return new Window(live.start(), live.count(), true);
        });
        if (windows.size() > PRUNE_AT) {
            windows.values().removeIf(w -> !isLive(w, now));
            if (windows.size() > MAX_KEYS) windows.clear();
        }
        return decision[0];
    }

    private boolean isLive(Window w, Instant now) {
        return now.isBefore(w.start().plus(window));
    }
}
