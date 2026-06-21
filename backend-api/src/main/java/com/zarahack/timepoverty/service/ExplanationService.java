package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.PersonalCompareResponse;
import com.zarahack.timepoverty.dto.SimulationResponse;
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

    /** Backwards-compatible entry point — defaults to Bulgarian. */
    public String explain(PersonalCompareResponse r) {
        return explain(r, null);
    }

    /** {@code language} is the UI locale ("bg" | "en"); anything but "en" yields Bulgarian. */
    public String explain(PersonalCompareResponse r, String language) {
        boolean bg = !"en".equalsIgnoreCase(language == null ? "" : language.trim());
        if (geminiKey != null && !geminiKey.isBlank()) {
            try {
                String text = geminiExplain(r, bg);
                if (text != null && !text.isBlank()) return text.trim();
            } catch (Exception e) {
                // Network/HTTP/parse/timeout — fall through to the deterministic narrative.
            }
        }
        return deterministicExplain(r, bg);
    }

    // ---- Municipal: good/bad-site explanation for a simulated placement ----

    /**
     * Reads a municipal placement (one simulated facility) and explains whether the
     * spot is a good or poor site and why. {@code amenityLabel}/{@code town} are
     * free-text context; {@code language} is the UI locale ("bg" | "en").
     */
    public String explainSite(SimulationResponse sim, String amenityType, String town, String language) {
        boolean bg = !"en".equalsIgnoreCase(language == null ? "" : language.trim());
        String amenityLabel = amenityLabel(amenityType, bg);
        if (geminiKey != null && !geminiKey.isBlank()) {
            try {
                String text = geminiExplainSite(sim, amenityLabel, town, bg);
                if (text != null && !text.isBlank()) return text.trim();
            } catch (Exception e) {
                // fall through to deterministic
            }
        }
        return deterministicSite(sim, amenityLabel, town, bg);
    }

    /** Localized facility label for the write-up (input is the raw amenity type). */
    private static String amenityLabel(String amenityType, boolean bg) {
        String a = amenityType == null ? "" : amenityType.trim().toLowerCase(Locale.ROOT);
        if (bg) {
            switch (a) {
                case "kindergarten": return "детска градина";
                case "school":       return "училище";
                case "clinic":       return "поликлиника";
                case "hospital":     return "болница";
                case "pharmacy":     return "аптека";
                default:             return a.isEmpty() ? "обект" : a;
            }
        }
        switch (a) {
            case "kindergarten": return "kindergarten";
            case "school":       return "school";
            case "clinic":       return "clinic";
            case "hospital":     return "hospital";
            case "pharmacy":     return "pharmacy";
            default:             return a.isEmpty() ? "facility" : a;
        }
    }

    private String geminiExplainSite(SimulationResponse sim, String amenityLabel, String town, boolean bg)
            throws Exception {
        String body = "{\"contents\":[{\"parts\":[{\"text\":\"" + jsonEscape(buildSitePrompt(sim, amenityLabel, town, bg))
                + "\"}]}],\"generationConfig\":{\"temperature\":0.4,\"maxOutputTokens\":400}}";
        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + geminiModel + ":generateContent?key=" + geminiKey;
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) throw new RuntimeException("Gemini HTTP " + res.statusCode());
        String text = extractFirstText(res.body());
        if (text == null) throw new RuntimeException("Gemini: no text field in response");
        return text;
    }

    private String buildSitePrompt(SimulationResponse sim, String amenityLabel, String town, boolean bg) {
        String where = (town == null || town.isBlank()) ? (bg ? "избраната точка" : "this location") : town;
        StringBuilder f = new StringBuilder();
        if (bg) {
            f.append("Ти си съветник по градско планиране. Обясни на ясен български дали ТОВА е добро ")
             .append("или лошо място за нов обект и защо. Използвай САМО фактите по-долу; не измисляй. ")
             .append("Напиши 2-3 кратки изречения, без markdown, без списъци. Отговори на български.\n\n");
        } else {
            f.append("You are an urban-planning advisor. Explain in plain English whether THIS is a good ")
             .append("or poor site for a new facility and why. Use ONLY the facts below; do not invent. ")
             .append("Write 2-3 short sentences, no markdown, no lists.\n\n");
        }
        f.append(String.format(Locale.US, "New facility: %s near %s.%n", amenityLabel, where));
        f.append(String.format(Locale.US,
            "If built here it would save about %.0f wasted hours/year, helping %d people across %d neighborhoods, "
            + "cutting roughly %.1f minutes off each one-way trip for those affected.%n",
            sim.annualWastedHoursSaved, sim.peopleImpacted, sim.affectedCells, sim.minutesSavedPerTripAvg));
        if (sim.affectedCells == 0) {
            f.append(bg
                ? "Никое домакинство не печели — наблизо вече има по-близък подобен обект.\n"
                : "No household benefits — a similar facility is already closer nearby.\n");
        }
        return f.toString();
    }

    private String deterministicSite(SimulationResponse sim, String amenityLabel, String town, boolean bg) {
        String where = (town == null || town.isBlank()) ? (bg ? "тази точка" : "this spot") : town;
        double hrs = sim.annualWastedHoursSaved;
        String hStr = String.format(Locale.US, "%.0f", hrs);
        String mStr = String.format(Locale.US, "%.1f", sim.minutesSavedPerTripAvg);
        StringBuilder sb = new StringBuilder();
        if (bg) {
            if (sim.affectedCells == 0 || hrs < 1) {
                sb.append("Слаба локация за ").append(amenityLabel.toLowerCase(Locale.ROOT))
                  .append(" — наблизо вече има по-близък обект, така че ").append(where)
                  .append(" не връща почти никакво време. Опитай по-отдалечен, по-зле обслужван район.");
            } else {
                String strength = hrs >= 200_000 ? "Отлична" : hrs >= 40_000 ? "Добра" : "Прилична";
                sb.append(strength).append(" локация: нов ").append(amenityLabel.toLowerCase(Locale.ROOT))
                  .append(" при ").append(where).append(" би спестил около ").append(hStr)
                  .append(" часа годишно за ").append(sim.peopleImpacted)
                  .append(" души, съкращавайки ~").append(mStr).append(" мин. на пътуване в едната посока. ")
                  .append(hrs >= 40_000
                      ? "Високо въздействие — приоритетен кандидат за строеж."
                      : "Умерено въздействие — полезно, но има и по-силни места.");
            }
        } else {
            if (sim.affectedCells == 0 || hrs < 1) {
                sb.append("Weak site for a ").append(amenityLabel.toLowerCase(Locale.ROOT))
                  .append(" — a closer facility already serves the area, so ").append(where)
                  .append(" returns almost no time. Try a more remote, under-served area.");
            } else {
                String strength = hrs >= 200_000 ? "Excellent" : hrs >= 40_000 ? "Strong" : "Decent";
                sb.append(strength).append(" site: a new ").append(amenityLabel.toLowerCase(Locale.ROOT))
                  .append(" near ").append(where).append(" would save about ").append(hStr)
                  .append(" hours/year for ").append(sim.peopleImpacted)
                  .append(" people, cutting ~").append(mStr).append(" min off each one-way trip. ")
                  .append(hrs >= 40_000
                      ? "High impact — a priority build candidate."
                      : "Moderate impact — useful, though stronger spots exist.");
            }
        }
        return sb.toString();
    }

    // ---- Personal: per-area suggestion explanation ----

    /**
     * Explains why a suggested area suits a household with the given needs. Grounded
     * ONLY on the area's own weekly travel time for those needs (deterministic from
     * spot + filters) — never on the user's current home — so the result is identical
     * for every requester and safe to cache. {@code language} is the UI locale.
     */
    public String explainArea(String settlement, String district, double weeklyHours,
                              List<String> needs, boolean hasCar, String language) {
        boolean bg = !"en".equalsIgnoreCase(language == null ? "" : language.trim());
        if (geminiKey != null && !geminiKey.isBlank()) {
            try {
                String text = geminiExplainArea(settlement, district, weeklyHours, needs, hasCar, bg);
                if (text != null && !text.isBlank()) return text.trim();
            } catch (Exception e) {
                // fall through to deterministic
            }
        }
        return deterministicArea(settlement, district, weeklyHours, needs, hasCar, bg);
    }

    private String geminiExplainArea(String settlement, String district, double weeklyHours,
                                     List<String> needs, boolean hasCar, boolean bg) throws Exception {
        String body = "{\"contents\":[{\"parts\":[{\"text\":\""
                + jsonEscape(buildAreaPrompt(settlement, district, weeklyHours, needs, hasCar, bg))
                + "\"}]}],\"generationConfig\":{\"temperature\":0.4,\"maxOutputTokens\":400}}";
        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + geminiModel + ":generateContent?key=" + geminiKey;
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) throw new RuntimeException("Gemini HTTP " + res.statusCode());
        String text = extractFirstText(res.body());
        if (text == null) throw new RuntimeException("Gemini: no text field in response");
        return text;
    }

    private String buildAreaPrompt(String settlement, String district, double weeklyHours,
                                   List<String> needs, boolean hasCar, boolean bg) {
        String where = (settlement == null || settlement.isBlank())
                ? (bg ? "този район" : "this area") : settlement;
        String needList = joinNeeds(needs, bg);
        StringBuilder f = new StringBuilder();
        if (bg) {
            f.append("Ти си съветник по преместване. Обясни на ясен, приятелски български защо този район ")
             .append("е подходящ за домакинство, което редовно ползва изброените услуги. ")
             .append("Използвай САМО фактите по-долу; не измисляй. Не споменавай текущото жилище на потребителя. ")
             .append("Напиши 2-3 кратки изречения, без markdown, без списъци. Отговори на български.\n\n");
            f.append(String.format(Locale.US, "Район: %s (област %s).%n", where, district == null ? "?" : district));
            f.append(String.format(Locale.US,
                "Седмично време за пътуване до услугите (%s): около %.1f часа общо. Домакинството %s кола.%n",
                needList, weeklyHours, hasCar ? "има" : "няма"));
        } else {
            f.append("You are a relocation advisor. Explain in plain, friendly English why this area suits ")
             .append("a household that regularly uses the services listed. Use ONLY the facts below; do not invent. ")
             .append("Do not mention the user's current home. Write 2-3 short sentences, no markdown, no lists.\n\n");
            f.append(String.format(Locale.US, "Area: %s (%s province).%n", where, district == null ? "?" : district));
            f.append(String.format(Locale.US,
                "Weekly travel to its services (%s): about %.1f hours total. The household %s a car.%n",
                needList, weeklyHours, hasCar ? "has" : "does not have"));
        }
        return f.toString();
    }

    private String deterministicArea(String settlement, String district, double weeklyHours,
                                     List<String> needs, boolean hasCar, boolean bg) {
        String where = (settlement == null || settlement.isBlank())
                ? (bg ? "този район" : "this area") : settlement;
        String needList = joinNeeds(needs, bg);
        String hStr = String.format(Locale.US, "%.1f", weeklyHours);
        // Low absolute weekly travel = a well-connected area for these needs.
        boolean good = weeklyHours <= 3.0;
        boolean ok = weeklyHours <= 6.0;
        StringBuilder sb = new StringBuilder();
        if (bg) {
            String strength = good ? "Силен" : ok ? "Приличен" : "По-слаб";
            sb.append(strength).append(" избор: от ").append(where)
              .append(" домакинство, което ползва ").append(needList)
              .append(", би пътувало около ").append(hStr).append(" часа седмично до тези услуги. ")
              .append(good ? "Услугите са близо — малко изгубено време."
                          : ok ? "Достъпът е приемлив за повечето нужди."
                               : "Някои услуги са по-далеч — очаквай повече време в път.");
            if (!hasCar) sb.append(" Без кола далечните пътувания тежат повече.");
        } else {
            String strength = good ? "Strong" : ok ? "Decent" : "Weaker";
            sb.append(strength).append(" choice: from ").append(where)
              .append(", a household needing ").append(needList)
              .append(" would travel about ").append(hStr).append(" hours a week to those services. ")
              .append(good ? "Services sit close by — little time lost."
                          : ok ? "Access is reasonable for most needs."
                               : "Some services are farther out — expect more time on the road.");
            if (!hasCar) sb.append(" Without a car, the longer trips weigh more.");
        }
        return sb.toString();
    }

    /** Localized, comma-joined list of need labels for the prompt/fallback. */
    private String joinNeeds(List<String> needs, boolean bg) {
        if (needs == null || needs.isEmpty()) return bg ? "услуги" : "services";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < needs.size(); i++) {
            if (i > 0) b.append(i == needs.size() - 1 ? (bg ? " и " : " and ") : ", ");
            b.append(amenityLabel(needs.get(i), bg));
        }
        return b.toString();
    }

    // ---- Gemini ----

    private String geminiExplain(PersonalCompareResponse r, boolean bg) throws Exception {
        String body = "{\"contents\":[{\"parts\":[{\"text\":\"" + jsonEscape(buildPrompt(r, bg))
                + "\"}]}],\"generationConfig\":{\"temperature\":0.4,\"maxOutputTokens\":600}}";
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
    private String buildPrompt(PersonalCompareResponse r, boolean bg) {
        StringBuilder f = new StringBuilder();
        if (bg) {
            f.append("Помагаш на едно домакинство да разбере евентуално преместване, като обясняваш ")
             .append("компромиса във времето за пътуване на ясен, приятелски български език. ")
             .append("Използвай САМО фактите по-долу; не измисляй подробности. ")
             .append("Напиши 2-3 кратки изречения, без markdown, без списъци. Отговори на български.\n\n");
        } else {
            f.append("You help a household understand a potential move by explaining the travel-time tradeoff ")
             .append("in plain, friendly English. Use ONLY the facts below; do not invent specifics. ")
             .append("Write 2-3 short sentences, no markdown, no lists.\n\n");
        }
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

    private String deterministicExplain(PersonalCompareResponse r, boolean bg) {
        return bg ? deterministicBg(r) : deterministicEn(r);
    }

    private String deterministicEn(PersonalCompareResponse r) {
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

    private String deterministicBg(PersonalCompareResponse r) {
        StringBuilder sb = new StringBuilder();
        double shift = Math.abs(r.efficiencyShiftHours);
        String shiftStr = String.format(Locale.US, "%.1f", shift);
        String perYear = String.format(Locale.US, "%.0f", shift * 52);

        if (r.gain) {
            sb.append("Преместването в новия дом би върнало около ")
              .append(shiftStr).append(" часа всяка седмица на вашето домакинство — приблизително ")
              .append(perYear).append(" часа годишно, които иначе бихте прекарали в пътуване. ");
        } else if (shift < 0.05) {
            sb.append("Двете местоположения са практически равностойни по седмично време за пътуване; ")
              .append("нито един от вариантите не променя съществено времевия данък на домакинството ви. ");
        } else {
            sb.append("Новият дом всъщност би ви струвал около ")
              .append(shiftStr).append(" допълнителни часа седмично (~")
              .append(perYear).append(" часа годишно) в повече пътуване. ");
        }

        PersonalCompareResponse.NeedBreakdown worstNow = max(r.currentBreakdown);
        if (worstNow != null) {
            sb.append("Днес най-голямата ви загуба на време е ")
              .append(bgLabel(worstNow))
              .append(" — ").append(String.format(Locale.US, "%.0f", worstNow.nearestMinutes))
              .append(" мин. в едната посока. ");
        }
        PersonalCompareResponse.NeedBreakdown worstThen = max(r.prospectiveBreakdown);
        if (worstThen != null && worstNow != null && !worstThen.label.equals(worstNow.label)) {
            sb.append("След преместването основното ограничение става ")
              .append(bgLabel(worstThen)).append(". ");
        }

        sb.append(r.gain
            ? "Като цяло преместването подобрява достъпа ви до избраните услуги."
            : "Като цяло, преценете тази загуба на време спрямо другите причини за преместването.");
        return sb.toString();
    }

    /** Bulgarian label for a breakdown row, keyed by its service group; falls back to the English label. */
    private static String bgLabel(PersonalCompareResponse.NeedBreakdown b) {
        if (b == null) return "";
        switch (b.group == null ? "" : b.group) {
            case "kindergarten":  return "детската градина";
            case "school":        return "училището";
            case "clinic":        return "поликлиниката";
            case "hospital":      return "болницата";
            case "pharmacy":      return "аптеката";
            case "children_0_6":  return "децата (градина / училище)";
            case "seniors_65p":   return "грижата за възрастни (поликлиника / болница / аптека)";
            default:              return b.label == null ? "" : b.label.toLowerCase(Locale.ROOT);
        }
    }

    private PersonalCompareResponse.NeedBreakdown max(List<PersonalCompareResponse.NeedBreakdown> bs) {
        return bs == null ? null : bs.stream()
                .max(Comparator.comparingDouble(b -> b.weeklyHours)).orElse(null);
    }
}
