package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.PersonalCompareResponse;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Generates the natural-language interpretation shown to paid (tier-1) users.
 *
 * Currently a deterministic, data-grounded narrative built from the compare
 * result — no external LLM call, so it works offline with no API key. The seam
 * is intentional: swap this body for a Claude call (claude-opus-4-8) when a key
 * is wired, keeping the same method signature.
 */
@Service
public class ExplanationService {

    public String explain(PersonalCompareResponse r) {
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
