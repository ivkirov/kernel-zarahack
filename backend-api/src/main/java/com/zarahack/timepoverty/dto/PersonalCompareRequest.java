package com.zarahack.timepoverty.dto;

public class PersonalCompareRequest {
    public double currentLat;
    public double currentLon;
    public double prospectiveLat;
    public double prospectiveLon;
    public HouseholdProfile householdProfile;

    public static class HouseholdProfile {
        public boolean hasChildren;
        public boolean needsSeniorCare;
    }
}
