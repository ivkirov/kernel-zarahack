package com.zarahack.timepoverty.dto;

import java.util.List;

public class PersonalCompareRequest {
    public double currentLat;
    public double currentLon;
    public double prospectiveLat;
    public double prospectiveLon;
    public HouseholdProfile householdProfile;
    // UI locale ("bg" | "en"); drives the language of the AI explanation. Defaults to bg.
    public String language;

    public static class HouseholdProfile {
        // Legacy coarse toggles (kept for backward compatibility).
        public boolean hasChildren;
        public boolean needsSeniorCare;
        // New: fine-grained per-amenity needs the household actually travels for,
        // e.g. ["kindergarten","clinic","pharmacy"]. When present, this takes
        // precedence over the coarse flags above.
        public List<String> needs;
        // Owns a car → drive to services beyond the walk threshold. Defaults true
        // (the UI checkbox is on by default); false means everything is on foot.
        public boolean hasCar = true;
    }
}
