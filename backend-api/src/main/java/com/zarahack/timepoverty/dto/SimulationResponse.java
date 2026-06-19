package com.zarahack.timepoverty.dto;

import java.util.List;

public class SimulationResponse {
    public String amenityType;
    public String affectedGroup;          // children_0_6 | seniors_65p
    public int affectedCells;             // cells whose nearest service improved
    public int peopleImpacted;            // sum of population in improved cells
    public double minutesSavedPerTripAvg; // mean one-way minutes reduced
    public double annualWastedHoursSaved; // headline ROI metric
    public List<CellDelta> deltas;        // per-cell breakdown for map shading

    public static class CellDelta {
        public String cellId;
        public double lat;
        public double lon;
        public int population;
        public double beforeMinutes;
        public double afterMinutes;
        public double hoursSavedAnnual;
    }
}
