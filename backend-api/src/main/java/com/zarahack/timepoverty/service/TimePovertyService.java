package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.*;
import com.zarahack.timepoverty.entity.DemographicWeight;
import com.zarahack.timepoverty.entity.InfrastructureNode;
import com.zarahack.timepoverty.repository.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class TimePovertyService {

    private final InfrastructureNodeRepository nodeRepo;
    private final DemographicWeightRepository weightRepo;

    @Value("${app.geo.assumed-speed-kmh}") private double speedKmh;
    @Value("${app.visits-per-year.children_0_6}") private int visitsChildren;
    @Value("${app.visits-per-year.seniors_65p}") private int visitsSeniors;

    // group -> which service types serve it
    private static final Map<String, List<String>> GROUP_SERVICES = Map.of(
        "children_0_6", List.of("kindergarten", "school"),
        "seniors_65p",  List.of("hospital", "clinic", "pharmacy")
    );

    public TimePovertyService(InfrastructureNodeRepository n, DemographicWeightRepository w) {
        this.nodeRepo = n; this.weightRepo = w;
    }

    private int visitsFor(String group) {
        return "children_0_6".equals(group) ? visitsChildren : visitsSeniors;
    }

    // A blank / "all" district means evaluate the whole country (all 28 provinces).
    private boolean isNationwide(String d) {
        return d == null || d.isBlank() || d.equalsIgnoreCase("all") || d.equalsIgnoreCase("All Bulgaria");
    }
    private List<InfrastructureNode> nodesFor(String d) {
        return isNationwide(d) ? nodeRepo.findAll() : nodeRepo.findByDistrict(d);
    }
    private List<DemographicWeight> weightsFor(String d) {
        return isNationwide(d) ? weightRepo.findAll() : weightRepo.findByDistrict(d);
    }

    /** Minimum one-way travel time (minutes) from a cell to the nearest serving node. */
    private double nearestMinutes(double lat, double lon, List<InfrastructureNode> serviceNodes) {
        double best = Double.MAX_VALUE;
        for (InfrastructureNode node : serviceNodes) {
            double km = GeoUtil.haversineKm(lat, lon, node.getLat(), node.getLon());
            double min = GeoUtil.travelMinutes(km, speedKmh);
            if (min < best) best = min;
        }
        return best == Double.MAX_VALUE ? 0.0 : best;
    }

    /** Annual wasted hours for one cell: oneWay × 2 (round trip) × visits/yr × pop ÷ 60. */
    private double annualHours(double oneWayMinutes, int population, String group) {
        return (oneWayMinutes * 2.0 * visitsFor(group) * population) / 60.0;
    }

    // ---------- GET /matrix ----------
    public MatrixResponse buildMatrix(String district) {
        List<InfrastructureNode> nodes = nodesFor(district);
        List<DemographicWeight> weights = weightsFor(district);
        // Pre-bucket nodes by the group they serve so we don't re-filter for every cell
        // (matters for the nationwide view: ~14k cells x ~2.8k nodes).
        Map<String, List<InfrastructureNode>> servingByGroup = new HashMap<>();
        GROUP_SERVICES.forEach((g, svc) ->
            servingByGroup.put(g, nodes.stream().filter(n -> svc.contains(n.getServiceType())).toList()));

        MatrixResponse resp = new MatrixResponse();
        resp.district = district;
        resp.nodes = new ArrayList<>();
        resp.cells = new ArrayList<>();
        double systemic = 0.0;

        for (InfrastructureNode n : nodes) {
            MatrixResponse.NodeView nv = new MatrixResponse.NodeView();
            nv.serviceType = n.getServiceType(); nv.name = n.getName();
            nv.lat = n.getLat(); nv.lon = n.getLon();
            resp.nodes.add(nv);
        }

        for (DemographicWeight w : weights) {
            List<InfrastructureNode> serving = servingByGroup.getOrDefault(w.getGroupKey(), List.of());
            double tNearest = nearestMinutes(w.getLat(), w.getLon(), serving);
            double hours = annualHours(tNearest, w.getPopulation(), w.getGroupKey());
            systemic += hours;

            MatrixResponse.CellScore cs = new MatrixResponse.CellScore();
            cs.cellId = w.getCellId(); cs.settlement = w.getSettlement();
            cs.groupKey = w.getGroupKey(); cs.lat = w.getLat(); cs.lon = w.getLon();
            cs.population = w.getPopulation();
            cs.nearestMinutes = tNearest;
            cs.timePovertyScore = tNearest * w.getPopulation();   // the formula
            cs.annualWastedHours = hours;
            resp.cells.add(cs);
        }
        resp.totalAnnualWastedHours = systemic;
        return resp;
    }

    // ---------- POST /simulate ----------
    public SimulationResponse simulate(SimulationRequest req) {
        // Which group does this new amenity serve?
        String group = GROUP_SERVICES.entrySet().stream()
            .filter(e -> e.getValue().contains(req.amenityType))
            .map(Map.Entry::getKey).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown amenity: " + req.amenityType));

        List<InfrastructureNode> nodes = nodesFor(req.district);
        List<DemographicWeight> weights = weightsFor(req.district).stream()
            .filter(w -> w.getGroupKey().equals(group)).toList();

        List<String> services = GROUP_SERVICES.get(group);
        List<InfrastructureNode> serving = nodes.stream()
            .filter(n -> services.contains(n.getServiceType())).toList();

        SimulationResponse out = new SimulationResponse();
        out.amenityType = req.amenityType;
        out.affectedGroup = group;
        out.deltas = new ArrayList<>();

        double totalSaved = 0.0, sumMinutesSaved = 0.0;
        int affected = 0, people = 0;

        for (DemographicWeight w : weights) {
            double before = nearestMinutes(w.getLat(), w.getLon(), serving);

            // distance to the NEW simulated node
            double kmNew = GeoUtil.haversineKm(w.getLat(), w.getLon(), req.lat, req.lon);
            double minNew = GeoUtil.travelMinutes(kmNew, speedKmh);
            double after = Math.min(before, minNew);

            if (after < before - 1e-6) {        // this cell genuinely improved
                double hoursBefore = annualHours(before, w.getPopulation(), group);
                double hoursAfter  = annualHours(after,  w.getPopulation(), group);
                double saved = hoursBefore - hoursAfter;

                totalSaved += saved;
                sumMinutesSaved += (before - after);
                affected++;
                people += w.getPopulation();

                SimulationResponse.CellDelta cd = new SimulationResponse.CellDelta();
                cd.cellId = w.getCellId(); cd.lat = w.getLat(); cd.lon = w.getLon();
                cd.population = w.getPopulation();
                cd.beforeMinutes = before; cd.afterMinutes = after;
                cd.hoursSavedAnnual = saved;
                out.deltas.add(cd);
            }
        }

        out.affectedCells = affected;
        out.peopleImpacted = people;
        out.minutesSavedPerTripAvg = affected == 0 ? 0.0 : sumMinutesSaved / affected;
        out.annualWastedHoursSaved = totalSaved;
        return out;
    }

    // ---------- POST /personal-compare ----------

    /** Weekly round-trip hours for one need: oneWay × 2 × (visits/yr ÷ 52 weeks) ÷ 60. */
    private double weeklyHours(double oneWayMinutes, String group) {
        double weeklyVisits = visitsFor(group) / 52.0;
        return (oneWayMinutes * 2.0 * weeklyVisits) / 60.0;
    }

    private double appendBreakdown(List<PersonalCompareResponse.NeedBreakdown> sink,
                                   String group, double lat, double lon,
                                   List<InfrastructureNode> serving) {
        double oneWay = nearestMinutes(lat, lon, serving);
        double hours = weeklyHours(oneWay, group);
        PersonalCompareResponse.NeedBreakdown b = new PersonalCompareResponse.NeedBreakdown();
        b.group = group;
        b.nearestMinutes = oneWay;
        b.weeklyHours = hours;
        sink.add(b);
        return hours;
    }

    public PersonalCompareResponse personalCompare(PersonalCompareRequest req) {
        // Single shared local DB / single pilot district → evaluate against all known nodes.
        List<InfrastructureNode> nodes = nodeRepo.findAll();

        boolean hasChildren = req.householdProfile != null && req.householdProfile.hasChildren;
        boolean needsSenior = req.householdProfile != null && req.householdProfile.needsSeniorCare;

        List<String> groups = new ArrayList<>();
        if (hasChildren) groups.add("children_0_6");
        if (needsSenior) groups.add("seniors_65p");
        if (groups.isEmpty()) {            // no profile selected → evaluate both needs
            groups.add("children_0_6");
            groups.add("seniors_65p");
        }

        PersonalCompareResponse out = new PersonalCompareResponse();
        out.currentBreakdown = new ArrayList<>();
        out.prospectiveBreakdown = new ArrayList<>();

        double current = 0.0, prospective = 0.0;
        for (String group : groups) {
            List<String> services = GROUP_SERVICES.getOrDefault(group, List.of());
            List<InfrastructureNode> serving = nodes.stream()
                .filter(n -> services.contains(n.getServiceType())).toList();

            current += appendBreakdown(out.currentBreakdown, group,
                req.currentLat, req.currentLon, serving);
            prospective += appendBreakdown(out.prospectiveBreakdown, group,
                req.prospectiveLat, req.prospectiveLon, serving);
        }

        out.currentWeeklyHours = current;
        out.prospectiveWeeklyHours = prospective;
        out.efficiencyShiftHours = current - prospective;   // positive ⇒ hours returned
        out.gain = out.efficiencyShiftHours > 0;
        return out;
    }
}
