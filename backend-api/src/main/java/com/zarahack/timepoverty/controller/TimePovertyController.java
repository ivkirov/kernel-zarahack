package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.*;
import com.zarahack.timepoverty.service.RadarService;
import com.zarahack.timepoverty.service.TimePovertyService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/time-poverty")
@CrossOrigin(origins = "*")   // dev only; locked down in CorsConfig for the demo origin
public class TimePovertyController {

    private final TimePovertyService service;
    private final RadarService radarService;

    public TimePovertyController(TimePovertyService service, RadarService radarService) {
        this.service = service;
        this.radarService = radarService;
    }

    /** Baseline systemic time loss + all nodes/cells for the district. */
    @GetMapping("/matrix")
    public MatrixResponse matrix(@RequestParam(defaultValue = "Pazardzhik") String district) {
        return service.buildMatrix(district);
    }

    /** Simulate placing a new node; return Annual Wasted Hours Saved. */
    @PostMapping("/simulate")
    public SimulationResponse simulate(@RequestBody SimulationRequest request) {
        return service.simulate(request);
    }

    /** Compare personal weekly commute time-tax between current and prospective homes. */
    @PostMapping("/personal-compare")
    public PersonalCompareResponse personalCompare(@RequestBody PersonalCompareRequest request) {
        return service.personalCompare(request);
    }

    /** Civic Accountability Radar: planned municipal builds scraped from AOP. */
    @GetMapping("/planned-projects")
    public PlannedProjectsResponse plannedProjects(@RequestParam(required = false) String amenity) {
        return radarService.plannedProjects(amenity);
    }
}
