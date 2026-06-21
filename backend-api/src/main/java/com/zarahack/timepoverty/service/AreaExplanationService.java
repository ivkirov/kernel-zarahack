package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.PersonalSuggestResponse;
import com.zarahack.timepoverty.entity.AiExplanation;
import com.zarahack.timepoverty.repository.AiExplanationRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Attaches an AI explanation to every personal area suggestion, backed by a DB
 * cache.
 *
 * <p>Each explanation is keyed by the spot (the suggestion's coordinates) plus the
 * household's filters (sorted needs, car ownership, language) — and grounded on
 * nothing else. So the same place + same filters always yields the same text, and
 * we generate it at most once across all users: a cache hit returns instantly, a
 * miss generates via {@link ExplanationService} and stores the row.
 *
 * <p>The top-N explanations are produced concurrently so a cold request costs about
 * one Gemini round-trip instead of N sequential ones.
 */
@Service
public class AreaExplanationService {

    private static final String KIND = "personal_area";
    /** Coordinate precision for the cache key (~1 m); settlement centroids are stable. */
    private static final int COORD_DP = 5;

    private final ExplanationService explanations;
    private final AiExplanationRepository cache;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    public AreaExplanationService(ExplanationService explanations, AiExplanationRepository cache) {
        this.explanations = explanations;
        this.cache = cache;
    }

    /** Fill in {@code aiExplanation} for each suggestion, reading/writing the DB cache. */
    public void attachExplanations(PersonalSuggestResponse resp, List<String> needs,
                                   boolean hasCar, String language) {
        if (resp == null || resp.suggestions == null || resp.suggestions.isEmpty()) return;

        // Canonicalize the filters once — these are part of every key in this batch.
        List<String> needsSorted = needs == null ? List.of()
                : needs.stream().filter(n -> n != null && !n.isBlank())
                       .map(n -> n.trim().toLowerCase(Locale.ROOT)).distinct().sorted().toList();
        String needsCanon = String.join(",", needsSorted);
        String lang = "en".equalsIgnoreCase(language == null ? "" : language.trim()) ? "en" : "bg";

        List<CompletableFuture<Void>> futures = new ArrayList<>();
        for (PersonalSuggestResponse.Suggestion s : resp.suggestions) {
            futures.add(CompletableFuture.runAsync(
                    () -> fillOne(s, needsSorted, needsCanon, hasCar, lang), pool));
        }
        try {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        } catch (Exception ignored) {
            // Any straggler already fell back to deterministic text inside fillOne.
        }
    }

    private void fillOne(PersonalSuggestResponse.Suggestion s, List<String> needsSorted,
                         String needsCanon, boolean hasCar, String lang) {
        String key = cacheKey(s.lat, s.lon, needsCanon, hasCar, lang);
        try {
            var hit = cache.findByCacheKey(key);
            if (hit.isPresent()) {                       // someone already generated this
                s.aiExplanation = hit.get().getExplanation();
                return;
            }
        } catch (Exception e) {
            // DB read trouble — generate fresh rather than failing the suggestion.
        }

        String text = explanations.explainArea(
                s.settlement, s.district, s.weeklyHours, needsSorted, hasCar, lang);
        s.aiExplanation = text;

        try {
            cache.save(new AiExplanation(key, KIND, round(s.lat), round(s.lon),
                    needsCanon, hasCar, lang, text));
        } catch (DataIntegrityViolationException dup) {
            // A concurrent request inserted the same key first — its text is fine.
        } catch (Exception e) {
            // Persisting failed — the user still gets the explanation we just made.
        }
    }

    /** sha256 hex of the canonical "kind|lat|lon|needs|has_car|language". */
    private static String cacheKey(double lat, double lon, String needsCanon,
                                   boolean hasCar, String lang) {
        String canon = String.format(Locale.US, "%s|%.5f|%.5f|%s|%b|%s",
                KIND, round(lat), round(lon), needsCanon, hasCar, lang);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(canon.getBytes(StandardCharsets.UTF_8));
            return h.length == 0 ? canon : toHex(h);
        } catch (Exception e) {
            return canon;   // hashing unavailable — fall back to the raw key (still unique)
        }
    }

    private static double round(double v) {
        double f = Math.pow(10, COORD_DP);
        return Math.round(v * f) / f;
    }

    private static String toHex(byte[] bytes) {
        return java.util.HexFormat.of().formatHex(bytes);
    }
}
