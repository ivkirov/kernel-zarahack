package com.zarahack.timepoverty.dto;

import java.util.List;

public class PersonalCompareResponse {
    public double currentWeeklyHours;       // weekly commute time-tax from the current residence
    public double prospectiveWeeklyHours;   // weekly commute time-tax from the prospective residence
    public double efficiencyShiftHours;     // current − prospective; > 0 = hours returned per week
    public boolean gain;                    // true when the prospective move saves time
    public List<NeedBreakdown> currentBreakdown;
    public List<NeedBreakdown> prospectiveBreakdown;

    public static class NeedBreakdown {
        public String group;          // children_0_6 | seniors_65p
        public double nearestMinutes; // one-way travel time to the nearest serving facility
        public double weeklyHours;    // round-trip hours/week attributable to this need
    }
}
