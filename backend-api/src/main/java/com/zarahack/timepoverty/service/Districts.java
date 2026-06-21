package com.zarahack.timepoverty.service;

import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The fixed set of Bulgarian provinces the app serves (Latin names, matching the
 * {@code district} column), plus the nationwide alias.
 *
 * <p>Used to <b>canonicalize and bound</b> any caller-supplied district before it
 * becomes a cache key. {@code @Cacheable("matrix")} keys on the district string;
 * without this gate an attacker could send unlimited distinct values and grow the
 * cache without limit (a memory-exhaustion DoS). Canonicalizing here caps the key
 * space to ~29 known values and rejects anything else with a 400.
 */
public final class Districts {

    private Districts() {}

    /** Canonical nationwide key (collapses null / blank / "all" / "All Bulgaria"). */
    public static final String NATIONWIDE = "all";

    private static final Set<String> PROVINCES = Set.of(
        "Blagoevgrad", "Burgas", "Dobrich", "Gabrovo", "Sofia (Capital)", "Haskovo",
        "Kardzhali", "Kyustendil", "Lovech", "Montana", "Pazardzhik", "Pernik", "Pleven",
        "Plovdiv", "Razgrad", "Ruse", "Shumen", "Silistra", "Sliven", "Smolyan",
        "Sofia Province", "Stara Zagora", "Targovishte", "Varna", "Veliko Tarnovo",
        "Vidin", "Vratsa", "Yambol");

    /** Lower-cased lookup → canonical spelling. */
    private static final Map<String, String> BY_LOWER = PROVINCES.stream()
        .collect(Collectors.toMap(p -> p.toLowerCase(), p -> p));

    /**
     * @return the canonical district name, or {@link #NATIONWIDE} for the
     *         country-wide view.
     * @throws IllegalArgumentException (→ HTTP 400) for any unrecognized value, so
     *         arbitrary strings never reach the cache.
     */
    public static String canonical(String district) {
        if (district == null) return NATIONWIDE;
        String d = district.trim();
        if (d.isEmpty() || d.equalsIgnoreCase("all") || d.equalsIgnoreCase("All Bulgaria")) {
            return NATIONWIDE;
        }
        String canon = BY_LOWER.get(d.toLowerCase());
        if (canon == null) throw new IllegalArgumentException("Unknown district: " + d);
        return canon;
    }
}
