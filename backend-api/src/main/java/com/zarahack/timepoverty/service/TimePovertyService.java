package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.*;
import com.zarahack.timepoverty.entity.DemographicWeight;
import com.zarahack.timepoverty.entity.InfrastructureNode;
import com.zarahack.timepoverty.repository.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class TimePovertyService {

    private final InfrastructureNodeRepository nodeRepo;
    private final DemographicWeightRepository weightRepo;

    @Value("${app.geo.assumed-speed-kmh}") private double speedKmh;
    // Personal planner: walk nearby, drive far (see GeoUtil.travelMinutes mode-aware).
    @Value("${app.geo.personal.walk-speed-kmh:4.5}") private double pWalkKmh;
    @Value("${app.geo.personal.drive-speed-kmh:28}") private double pDriveKmh;
    @Value("${app.geo.personal.walk-threshold-km:1.2}") private double pWalkThresholdKm;
    @Value("${app.visits-per-year.children_0_6}") private int visitsChildren;
    @Value("${app.visits-per-year.seniors_65p}") private int visitsSeniors;

    // group -> which service types serve it
    private static final Map<String, List<String>> GROUP_SERVICES = Map.of(
        "children_0_6", List.of("kindergarten", "school"),
        "seniors_65p",  List.of("hospital", "clinic", "pharmacy")
    );

    // For a municipal placement, which existing services genuinely compete with the
    // new one. Pharmacies are excluded as substitutes for hospital/clinic care: they're
    // far denser (~1,600), so lumping them in made every hospital/clinic placement read
    // as "0 saved" (a pharmacy was always already closer than the new facility).
    private static final Map<String, List<String>> SIM_COMPETING = Map.of(
        "kindergarten", List.of("kindergarten", "school"),
        "school",       List.of("kindergarten", "school"),
        "clinic",       List.of("clinic", "hospital"),
        "hospital",     List.of("clinic", "hospital")
    );

    // Per-amenity round trips per year — used by the fine-grained personal planner so
    // each need is weighted by how often a household actually travels to it.
    private static final Map<String, Integer> SERVICE_VISITS = Map.of(
        "kindergarten", 380,   // ~daily drop-off + pickup over the school year
        "school",       380,
        "clinic",        18,
        "hospital",       6,
        "pharmacy",      30
    );
    private static final Map<String, String> SERVICE_LABEL = Map.of(
        "kindergarten", "Kindergarten",
        "school",       "School",
        "clinic",       "Clinic",
        "hospital",     "Hospital",
        "pharmacy",     "Pharmacy"
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

    /**
     * Minimum one-way travel time (minutes) from a cell to the nearest serving node.
     * Municipal lens now uses the same realistic mode-aware model as the personal
     * planner — walk up to {@code walk-threshold-km} (the 2 km rule), drive beyond —
     * so headline hours reflect how people actually reach a far facility (car), not a
     * 30 km walk.
     */
    private double nearestMinutes(double lat, double lon, List<InfrastructureNode> serviceNodes) {
        return municipalMinutes(lat, lon, serviceNodes);
    }

    /** Mode-aware (walk-then-drive) one-way minutes to the nearest serving node. */
    private double municipalMinutes(double lat, double lon, List<InfrastructureNode> serviceNodes) {
        double best = Double.MAX_VALUE;
        for (InfrastructureNode node : serviceNodes) {
            double km = GeoUtil.haversineKm(lat, lon, node.getLat(), node.getLon());
            double min = GeoUtil.travelMinutes(km, pWalkKmh, pDriveKmh, pWalkThresholdKm);
            if (min < best) best = min;
        }
        return best == Double.MAX_VALUE ? 0.0 : best;
    }

    /**
     * Personal planner nearest travel time. With a car, walk up to the threshold
     * then drive; without one, everything is on foot.
     */
    private double nearestMinutesPersonal(double lat, double lon,
                                          List<InfrastructureNode> serviceNodes, boolean hasCar) {
        double best = Double.MAX_VALUE;
        for (InfrastructureNode node : serviceNodes) {
            double km = GeoUtil.haversineKm(lat, lon, node.getLat(), node.getLon());
            double min = hasCar
                ? GeoUtil.travelMinutes(km, pWalkKmh, pDriveKmh, pWalkThresholdKm)
                : GeoUtil.travelMinutes(km, pWalkKmh);
            if (min < best) best = min;
        }
        return best == Double.MAX_VALUE ? 0.0 : best;
    }

    /** Annual wasted hours for one cell: oneWay × 2 (round trip) × visits/yr × pop ÷ 60. */
    private double annualHours(double oneWayMinutes, int population, String group) {
        return (oneWayMinutes * 2.0 * visitsFor(group) * population) / 60.0;
    }

    // ---------- GET /matrix ----------
    // Heavy for the nationwide view (~14k cells × ~2.8k nodes); cache by district so
    // repeat loads / province switches are instant.
    @Cacheable("matrix")
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

        // Compare the new facility against genuinely competing services (not pharmacies),
        // so placing a hospital/clinic actually shows the access it adds.
        List<String> services = SIM_COMPETING.getOrDefault(req.amenityType, GROUP_SERVICES.get(group));
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

            // distance to the NEW simulated node (same walk-then-drive 2 km model)
            double kmNew = GeoUtil.haversineKm(w.getLat(), w.getLon(), req.lat, req.lon);
            double minNew = GeoUtil.travelMinutes(kmNew, pWalkKmh, pDriveKmh, pWalkThresholdKm);
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

    /** Weekly round-trip hours for one amenity type at the household's own visit cadence. */
    private double weeklyHoursService(double oneWayMinutes, String serviceType) {
        double weeklyVisits = SERVICE_VISITS.getOrDefault(serviceType, 24) / 52.0;
        return (oneWayMinutes * 2.0 * weeklyVisits) / 60.0;
    }

    private double appendBreakdown(List<PersonalCompareResponse.NeedBreakdown> sink,
                                   String group, String label, double weeklyHours,
                                   double lat, double lon,
                                   List<InfrastructureNode> serving, boolean hasCar) {
        double oneWay = nearestMinutesPersonal(lat, lon, serving, hasCar);
        PersonalCompareResponse.NeedBreakdown b = new PersonalCompareResponse.NeedBreakdown();
        b.group = group;
        b.label = label;
        b.nearestMinutes = oneWay;
        b.weeklyHours = weeklyHours;
        sink.add(b);
        return weeklyHours;
    }

    private List<InfrastructureNode> servingOf(List<InfrastructureNode> nodes, List<String> services) {
        return nodes.stream().filter(n -> services.contains(n.getServiceType())).toList();
    }

    public PersonalCompareResponse personalCompare(PersonalCompareRequest req) {
        // Single shared local DB / single pilot district → evaluate against all known nodes.
        List<InfrastructureNode> nodes = nodeRepo.findAll();

        PersonalCompareResponse out = new PersonalCompareResponse();
        out.currentBreakdown = new ArrayList<>();
        out.prospectiveBreakdown = new ArrayList<>();

        // Fine-grained per-amenity needs take precedence when supplied.
        List<String> needs = (req.householdProfile != null && req.householdProfile.needs != null)
            ? req.householdProfile.needs.stream().filter(SERVICE_VISITS::containsKey).distinct().toList()
            : List.of();
        boolean hasCar = req.householdProfile == null || req.householdProfile.hasCar;

        double current = 0.0, prospective = 0.0;

        if (!needs.isEmpty()) {
            for (String svc : needs) {
                // In per-need mode `group` carries the service type so the UI can colour it.
                String label = SERVICE_LABEL.getOrDefault(svc, svc);
                List<InfrastructureNode> serving = servingOf(nodes, List.of(svc));

                double cMin = nearestMinutesPersonal(req.currentLat, req.currentLon, serving, hasCar);
                double pMin = nearestMinutesPersonal(req.prospectiveLat, req.prospectiveLon, serving, hasCar);
                current += appendBreakdown(out.currentBreakdown, svc, label,
                    weeklyHoursService(cMin, svc), req.currentLat, req.currentLon, serving, hasCar);
                prospective += appendBreakdown(out.prospectiveBreakdown, svc, label,
                    weeklyHoursService(pMin, svc), req.prospectiveLat, req.prospectiveLon, serving, hasCar);
            }
        } else {
            // Legacy coarse-group path (children / seniors).
            boolean hasChildren = req.householdProfile != null && req.householdProfile.hasChildren;
            boolean needsSenior = req.householdProfile != null && req.householdProfile.needsSeniorCare;
            List<String> groups = new ArrayList<>();
            if (hasChildren) groups.add("children_0_6");
            if (needsSenior) groups.add("seniors_65p");
            if (groups.isEmpty()) { groups.add("children_0_6"); groups.add("seniors_65p"); }

            for (String group : groups) {
                List<String> services = GROUP_SERVICES.getOrDefault(group, List.of());
                List<InfrastructureNode> serving = servingOf(nodes, services);
                String label = "children_0_6".equals(group) ? "Children (kindergarten / school)"
                                                             : "Senior care (clinic / hospital / pharmacy)";
                double cMin = nearestMinutesPersonal(req.currentLat, req.currentLon, serving, hasCar);
                double pMin = nearestMinutesPersonal(req.prospectiveLat, req.prospectiveLon, serving, hasCar);
                current += appendBreakdown(out.currentBreakdown, group, label,
                    weeklyHours(cMin, group), req.currentLat, req.currentLon, serving, hasCar);
                prospective += appendBreakdown(out.prospectiveBreakdown, group, label,
                    weeklyHours(pMin, group), req.prospectiveLat, req.prospectiveLon, serving, hasCar);
            }
        }

        out.currentWeeklyHours = current;
        out.prospectiveWeeklyHours = prospective;
        out.efficiencyShiftHours = current - prospective;   // positive ⇒ hours returned
        out.gain = out.efficiencyShiftHours > 0;
        return out;
    }

    // ---------- POST /personal-suggest (tier-1 paid) ----------
    /**
     * Rank candidate settlements by the lowest weekly travel time for the
     * household's selected needs, returning the best `topN` against the current pin.
     */
    public PersonalSuggestResponse suggestAreas(PersonalCompareRequest req, int topN) {
        return suggestAreas(req, topN, null, null, null, null);
    }

    /**
     * Suggest the best areas to live. When a viewport bbox (min/max lat+lon) is
     * given, candidates are restricted to what the user currently sees on the map,
     * so we never propose a town that's off-screen. With no bbox we fall back to
     * anchoring on the household's province.
     */
    public PersonalSuggestResponse suggestAreas(PersonalCompareRequest req, int topN,
                                                Double minLat, Double minLon,
                                                Double maxLat, Double maxLon) {
        List<InfrastructureNode> nodes = nodeRepo.findAll();

        List<String> needs = (req.householdProfile != null && req.householdProfile.needs != null)
            ? req.householdProfile.needs.stream().filter(SERVICE_VISITS::containsKey).distinct().toList()
            : List.of("kindergarten", "school", "clinic", "pharmacy");
        boolean hasCar = req.householdProfile == null || req.householdProfile.hasCar;

        // Pre-bucket serving nodes once per need (candidates × needs × nodes otherwise).
        Map<String, List<InfrastructureNode>> servingByNeed = new HashMap<>();
        for (String svc : needs) servingByNeed.put(svc, servingOf(nodes, List.of(svc)));

        PersonalSuggestResponse out = new PersonalSuggestResponse();
        out.currentWeeklyHours = weeklyHoursAt(req.currentLat, req.currentLon, needs, servingByNeed, hasCar);

        // One representative centroid per settlement (its largest-population cell).
        Map<String, DemographicWeight> bySettlement = new HashMap<>();
        for (DemographicWeight w : weightRepo.findAll()) {
            if (w.getSettlement() == null) continue;
            DemographicWeight cur = bySettlement.get(w.getSettlement());
            if (cur == null || w.getPopulation() > cur.getPopulation()) bySettlement.put(w.getSettlement(), w);
        }

        Collection<DemographicWeight> candidates = bySettlement.values();

        // Prefer the current map viewport: only suggest places the user can see.
        boolean haveBbox = minLat != null && minLon != null && maxLat != null && maxLon != null;
        List<DemographicWeight> inView = List.of();
        if (haveBbox) {
            double aLat = minLat, bLat = maxLat, aLon = minLon, bLon = maxLon;
            inView = candidates.stream()
                .filter(w -> w.getLat() >= aLat && w.getLat() <= bLat
                          && w.getLon() >= aLon && w.getLon() <= bLon)
                .toList();
        }
        if (!inView.isEmpty()) {
            candidates = inView;                       // viewport is the explicit scope
        } else {
            // No viewport (or nothing visible) → anchor to the household's province,
            // so we recommend nearby towns, not the single best settlement nationwide.
            String anchorDistrict = nearestDistrict(req.currentLat, req.currentLon, candidates);
            if (anchorDistrict != null) {
                List<DemographicWeight> inProvince = candidates.stream()
                    .filter(w -> anchorDistrict.equals(w.getDistrict())).toList();
                if (!inProvince.isEmpty()) candidates = inProvince;
            }
        }

        List<PersonalSuggestResponse.Suggestion> ranked = new ArrayList<>();
        for (DemographicWeight w : candidates) {
            double weekly = weeklyHoursAt(w.getLat(), w.getLon(), needs, servingByNeed, hasCar);
            PersonalSuggestResponse.Suggestion s = new PersonalSuggestResponse.Suggestion();
            s.settlement = w.getSettlement();
            s.district = w.getDistrict();
            s.lat = w.getLat(); s.lon = w.getLon();
            s.weeklyHours = weekly;
            s.hoursSavedVsCurrent = out.currentWeeklyHours - weekly;
            ranked.add(s);
        }
        ranked.sort(Comparator.comparingDouble(s -> s.weeklyHours));
        out.suggestions = ranked.stream().limit(Math.max(1, topN)).toList();
        return out;
    }

    /** Total weekly round-trip hours at a point across the given needs. */
    private double weeklyHoursAt(double lat, double lon, List<String> needs,
                                 Map<String, List<InfrastructureNode>> servingByNeed, boolean hasCar) {
        double total = 0.0;
        for (String svc : needs) {
            double oneWay = nearestMinutesPersonal(lat, lon, servingByNeed.getOrDefault(svc, List.of()), hasCar);
            total += weeklyHoursService(oneWay, svc);
        }
        return total;
    }

    /** District of the settlement centroid closest to a point (the household's province). */
    private String nearestDistrict(double lat, double lon, Collection<DemographicWeight> centroids) {
        double best = Double.MAX_VALUE;
        String district = null;
        for (DemographicWeight w : centroids) {
            double km = GeoUtil.haversineKm(lat, lon, w.getLat(), w.getLon());
            if (km < best) { best = km; district = w.getDistrict(); }
        }
        return district;
    }
}
