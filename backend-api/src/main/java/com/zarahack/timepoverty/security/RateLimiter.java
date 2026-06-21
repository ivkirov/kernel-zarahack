package com.zarahack.timepoverty.security;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tiny in-process fixed-window rate limiter — no external dependency, no shared
 * store. Used to blunt credential brute-force and auth spam (which also drives
 * expensive PBKDF2 work). It is best-effort and per-instance; a multi-node or
 * internet-facing deployment should additionally rate-limit at the proxy/WAF,
 * and note that a shared upstream proxy collapses many clients to one key.
 */
@Component
public class RateLimiter {

    private record Window(long resetAtMillis, AtomicInteger count) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    /**
     * @return true if this hit is allowed; false once {@code maxHits} is exceeded
     *         within the current {@code windowMillis} window for {@code key}.
     */
    public boolean allow(String key, int maxHits, long windowMillis) {
        long now = System.currentTimeMillis();
        // Opportunistic cleanup so the map can't grow unbounded under key churn.
        if (windows.size() > 10_000) windows.entrySet().removeIf(e -> e.getValue().resetAtMillis() <= now);

        Window w = windows.compute(key, (k, cur) ->
                (cur == null || cur.resetAtMillis() <= now)
                        ? new Window(now + windowMillis, new AtomicInteger(0))
                        : cur);
        return w.count().incrementAndGet() <= maxHits;
    }
}
