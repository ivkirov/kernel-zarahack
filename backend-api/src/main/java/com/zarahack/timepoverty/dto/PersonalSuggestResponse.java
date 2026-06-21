package com.zarahack.timepoverty.dto;

import java.util.List;

/**
 * Tier-1 paid feature: areas we suggest the household relocate to, ranked by the
 * lowest weekly travel time for their selected needs (same spirit as the
 * municipal site recommender, but optimising a private household instead).
 */
public class PersonalSuggestResponse {
    public double currentWeeklyHours;     // baseline from the household's current pin
    public List<Suggestion> suggestions;

    public static class Suggestion {
        public String settlement;
        public String district;
        public double lat;
        public double lon;
        public double weeklyHours;        // weekly time-tax if living here
        public double hoursSavedVsCurrent;// currentWeeklyHours − weeklyHours
        // Short AI write-up for THIS area, grounded only on the spot + the
        // household's filters (so it's cacheable + identical for every requester).
        public String aiExplanation;
    }
}
