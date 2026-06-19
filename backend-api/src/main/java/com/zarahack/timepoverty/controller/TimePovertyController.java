package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.*;
import com.zarahack.timepoverty.service.TimePovertyService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/time-poverty")
@CrossOrigin(origins = "*")   // dev only; locked down in CorsConfig for the demo origin
public class TimePovertyController {

    private final TimePovertyService service;

    public TimePovertyController(TimePovertyService service) {
        this.service = service;
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
}
