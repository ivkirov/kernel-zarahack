package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.PersonalCompareResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Generates the natural-language interpretation shown to paid (tier-1) users.
 *
 * When {@code app.gemini.api-key} is set, this calls Google Gemini
 * (model {@code app.gemini.model}, default {@code gemini-3.1-flash-lite}) with a
 * data-grounded prompt. With no key — or on any error/timeout — it falls back to
 * a deterministic narrative built from the compare result, so the feature always
 * works offline. JSON is built/parsed with the JDK only (no extra dependency).
 */
@Service
public class ExplanationService {

    @Value("${app.gemini.api-key:}") private String geminiKey;
    @Value("${app.gemini.model:gemini-3.1-flash-lite}") private String geminiModel;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    public String explain(PersonalCompareResponse r) {
        if (geminiKey != null && !geminiKey.isBlank()) {
            try {
                String text = geminiExplain(r);
                if (text != null && !text.isBlank()) return text.trim();
            } catch (Exception e) {
                // Network/HTTP/parse/timeout — fall through to the deterministic narrative.
            }
        }
        return deterministicExplain(r);
    }

    // ---- Gemini ----

    private String geminiExplain(PersonalCompareResponse r) throws Exception {
        String body = "{\"contents\":[{\"parts\":[{\"text\":\"" + jsonEscape(buildPrompt(r))
                + "\"}]}],\"generationConfig\":{\"temperature\":0.4,\"maxOutputTokens\":300}}";
        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + geminiModel + ":generateContent?key=" + geminiKey;
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            throw new RuntimeException("Gemini HTTP " + res.statusCode());
        }
        String text = extractFirstText(res.body());
        if (text == null) throw new RuntimeException("Gemini: no text field in response");
        return text;
    }

    /** Grounds the model on the computed numbers — it interprets, it doesn't invent. */
    private String buildPrompt(PersonalCompareResponse r) {
        StringBuilder f = new StringBuilder();
        f.append("You help a household understand a potential move by explaining the travel-time tradeoff ")
         .append("in plain, friendly English. Use ONLY the facts below; do not invent specifics. ")
         .append("Write 2-3 short sentences, no markdown, no lists.\n\n");
        f.append(String.format(Locale.US,
            "Current home weekly travel: %.1f hours. Prospective home weekly travel: %.1f hours.%n",
            r.currentWeeklyHours, r.prospectiveWeeklyHours));
        f.append(String.format(Locale.US,
            "Net effect of moving: %s about %.1f hours/week (~%.0f hours/year).%n",
            r.gain ? "saves" : "costs", Math.abs(r.efficiencyShiftHours), Math.abs(r.efficiencyShiftHours) * 52));
        f.append("Per-need one-way minutes (current -> prospective):\n");
        Map<String, PersonalCompareResponse.NeedBreakdown> proBy = new HashMap<>();
        if (r.prospectiveBreakdown != null) {
            for (PersonalCompareResponse.NeedBreakdown b : r.prospectiveBreakdown) proBy.put(b.label, b);
        }
        if (r.currentBreakdown != null) {
            for (PersonalCompareResponse.NeedBreakdown b : r.currentBreakdown) {
                PersonalCompareResponse.NeedBreakdown p = proBy.get(b.label);
                f.append(String.format(Locale.US, "- %s: %.0f -> %.0f min%n",
                    b.label, b.nearestMinutes, p != null ? p.nearestMinutes : b.nearestMinutes));
            }
        }
        return f.toString();
    }

    // ---- minimal JSON (avoids pulling Jackson onto this module's classpath) ----

    private static String jsonEscape(String s) {
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.toString();
    }

    /** Extract + unescape the first JSON string value of a "text" field (Gemini's reply). */
    private static String extractFirstText(String json) {
        int k = json.indexOf("\"text\"");
        if (k < 0) return null;
        int colon = json.indexOf(':', k);
        if (colon < 0) return null;
        int i = json.indexOf('"', colon + 1);
        if (i < 0) return null;
        StringBuilder out = new StringBuilder();
        for (i = i + 1; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '\\') {
                if (i + 1 >= json.length()) break;
                char n = json.charAt(++i);
                switch (n) {
                    case 'n': out.append('\n'); break;
                    case 't': out.append('\t'); break;
                    case 'r': out.append('\r'); break;
                    case 'b': out.append('\b'); break;
                    case 'f': out.append('\f'); break;
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    case '/': out.append('/'); break;
                    case 'u':
                        if (i + 4 < json.length()) {
                            out.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16));
                            i += 4;
                        }
                        break;
                    default: out.append(n);
                }
            } else if (c == '"') {
                break;
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    // ---- Deterministic fallback ----

    private String deterministicExplain(PersonalCompareResponse r) {
        StringBuilder sb = new StringBuilder();
        double shift = Math.abs(r.efficiencyShiftHours);
        String shiftStr = String.format(Locale.US, "%.1f", shift);
        String perYear = String.format(Locale.US, "%.0f", shift * 52);

        if (r.gain) {
            sb.append("Moving to the prospective home would return about ")
              .append(shiftStr).append(" hours every week to your household — roughly ")
              .append(perYear).append(" hours a year you'd otherwise spend in transit. ");
        } else if (shift < 0.05) {
            sb.append("The two locations are essentially equivalent in weekly travel time; ")
              .append("neither move meaningfully changes your household's time-tax. ");
        } else {
            sb.append("The prospective home would actually cost you about ")
              .append(shiftStr).append(" extra hours per week (~")
              .append(perYear).append(" hours a year) in additional travel. ");
        }

        // Call out the single biggest driver, current vs prospective.
        PersonalCompareResponse.NeedBreakdown worstNow = max(r.currentBreakdown);
        if (worstNow != null) {
            sb.append("Today your largest time sink is ")
              .append(worstNow.label.toLowerCase(Locale.ROOT))
              .append(" at ").append(String.format(Locale.US, "%.0f", worstNow.nearestMinutes))
              .append(" min each way. ");
        }
        PersonalCompareResponse.NeedBreakdown worstThen = max(r.prospectiveBreakdown);
        if (worstThen != null && worstNow != null && !worstThen.label.equals(worstNow.label)) {
            sb.append("After the move, ").append(worstThen.label.toLowerCase(Locale.ROOT))
              .append(" becomes the main constraint instead. ");
        }

        sb.append(r.gain
            ? "On balance, the relocation improves your access to the services you selected."
            : "On balance, weigh this time cost against your other reasons for the move.");
        return sb.toString();
    }

    private PersonalCompareResponse.NeedBreakdown max(List<PersonalCompareResponse.NeedBreakdown> bs) {
        return bs == null ? null : bs.stream()
                .max(Comparator.comparingDouble(b -> b.weeklyHours)).orElse(null);
    }
}
