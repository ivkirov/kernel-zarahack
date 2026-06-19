package com.zarahack.timepoverty.dto;

import java.util.List;

public class MatrixResponse {
    public String district;
    public double totalAnnualWastedHours;   // systemic baseline
    public List<NodeView> nodes;            // for map markers
    public List<CellScore> cells;           // for choropleth shading

    public static class NodeView {
        public String serviceType;
        public String name;
        public double lat;
        public double lon;
    }
    public static class CellScore {
        public String cellId;
        public String settlement;
        public String groupKey;
        public double lat;
        public double lon;
        public int population;
        public double nearestMinutes;       // T_nearest
        public double timePovertyScore;     // T_nearest × population
        public double annualWastedHours;
    }
}
