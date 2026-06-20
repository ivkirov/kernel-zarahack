package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.*;
import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.CurrentUser;
import com.zarahack.timepoverty.security.Features;
import com.zarahack.timepoverty.service.ExplanationService;
import com.zarahack.timepoverty.service.RadarService;
import com.zarahack.timepoverty.service.TimePovertyService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/time-poverty")
public class TimePovertyController {

    private final TimePovertyService service;
    private final RadarService radarService;
    private final ExplanationService explanationService;
    private final AppUserRepository users;

    public TimePovertyController(TimePovertyService service, RadarService radarService,
                                ExplanationService explanationService, AppUserRepository users) {
        this.service = service;
        this.radarService = radarService;
        this.explanationService = explanationService;
        this.users = users;
    }

    /**
     * Baseline matrix + nodes/cells. Shared map data used by all three lenses
     * (municipal choropleth, personal service dots, radar audit scaling), so it
     * only requires authentication — the municipal value-add is gated on /simulate.
     */
    @GetMapping("/matrix")
    public MatrixResponse matrix(@RequestParam(defaultValue = "Stara Zagora") String district) {
        CurrentUser.require();
        return service.buildMatrix(district);
    }

    /** Simulate placing a new node — municipal planner (tier 3) only. */
    @PostMapping("/simulate")
    public SimulationResponse simulate(@RequestBody SimulationRequest request) {
        AppUser u = CurrentUser.require();
        if (!Features.canMunicipal(u)) {
            throw new AuthException(403, "ACCESS_MUNICIPAL",
                    "The municipal planner requires an activated municipality account.");
        }
        return service.simulate(request);
    }

    /** Compare personal weekly commute time-tax — free (limited) or paid (tier 1). */
    @PostMapping("/personal-compare")
    public PersonalCompareResponse personalCompare(@RequestBody PersonalCompareRequest request) {
        AppUser u = CurrentUser.require();
        if (!Features.canPersonal(u)) {
            throw new AuthException(403, "ACCESS_PERSONAL",
                    "The relocation planner is for individual accounts.");
        }

        List<String> needs = (request.householdProfile != null && request.householdProfile.needs != null)
                ? request.householdProfile.needs : List.of();

        if (Features.isFree(u)) {
            // Free users may only filter by the allowed amenity set.
            for (String n : needs) {
                if (!Features.FREE_ALLOWED_AMENITIES.contains(n)) {
                    throw new AuthException(402, "PAYWALL_FILTER",
                            "Filtering by \"" + n + "\" requires a paid account.");
                }
            }
            // Usage-based quota.
            if (u.getFreeGuessesUsed() >= Features.FREE_GUESS_LIMIT) {
                throw new AuthException(402, "PAYWALL_QUOTA",
                        "You've used all " + Features.FREE_GUESS_LIMIT + " free relocation checks. Upgrade for unlimited access.");
            }
        }

        PersonalCompareResponse resp = service.personalCompare(request);

        if (Features.isFree(u)) {
            u.setFreeGuessesUsed(u.getFreeGuessesUsed() + 1);
            users.save(u);
            resp.freeGuessesRemaining = Math.max(0, Features.FREE_GUESS_LIMIT - u.getFreeGuessesUsed());
        } else if (Features.hasPaidPersonal(u)) {
            resp.aiExplanation = explanationService.explain(resp);   // tier-1 perk
        }
        return resp;
    }

    /** Suggest the best areas to live for the household's needs — tier-1 paid only. */
    @PostMapping("/personal-suggest")
    public PersonalSuggestResponse personalSuggest(@RequestBody PersonalCompareRequest request,
                                                   @RequestParam(defaultValue = "5") int top) {
        AppUser u = CurrentUser.require();
        if (!Features.hasPaidPersonal(u)) {
            throw new AuthException(402, "PAYWALL_UPGRADE",
                    "Area suggestions are a paid (tier 1) feature.");
        }
        return service.suggestAreas(request, top);
    }

    /** Civic Accountability Radar — reporter (tier 2) only. */
    @GetMapping("/planned-projects")
    public PlannedProjectsResponse plannedProjects(@RequestParam(required = false) String amenity) {
        AppUser u = CurrentUser.require();
        if (!Features.canReporter(u)) {
            throw new AuthException(403, "ACCESS_REPORTER",
                    "The Accountability Radar requires an activated reporter account.");
        }
        return radarService.plannedProjects(amenity);
    }
}
