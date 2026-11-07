package com.cgtcalculator.platform.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most {@code limit} different values per key in each fixed window (e.g. 50 companies a day per user); values
 * already counted stay allowed. Kept in memory, so a restart clears it.
 */
public final class DistinctLimiter {

    private record Window(Instant start, Set<String> values) {
    }

    private static final int PRUNE_AT = 10_000;

    private final int limit;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public DistinctLimiter(int limit, Duration window, Clock clock) {
        this.limit = limit;
        this.window = window;
        this.clock = clock;
    }

    /** Counts the value for the key; false when it is new and the key already has {@code limit} values. */
    public boolean acquire(String key, String value) {
        Instant now = clock.instant();
        boolean[] allowed = new boolean[1];
        windows.compute(key, (k, old) -> {
            Window live = old != null && isLive(old, now) ? old : new Window(now, ConcurrentHashMap.newKeySet());
            allowed[0] = live.values().contains(value) || live.values().size() < limit;
            if (allowed[0]) live.values().add(value);
            return live;
        });
        if (windows.size() > PRUNE_AT) windows.values().removeIf(w -> !isLive(w, now));
        return allowed[0];
    }

    /** When the key's window ends. */
    public long secondsLeft(String key) {
        Window w = windows.get(key);
        return w == null ? 0 : Math.max(1, Duration.between(clock.instant(), w.start().plus(window)).toSeconds());
    }

    private boolean isLive(Window w, Instant now) {
        return now.isBefore(w.start().plus(window));
    }
}
