package com.zarahack.timepoverty.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Reports the commit this backend was deployed from. Public by design — the
 * AuthFilter never rejects and this endpoint never calls CurrentUser.require().
 * Reads the deploy stamp written by scripts/deploy.sh; absent/blank path (e.g.
 * a local run with no deploy) yields {"status":"unknown"} rather than a 500.
 */
@RestController
@RequestMapping("/api/v1/version")
public class VersionController {

    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${app.deploy-stamp-path:}")
    private String stampPath;

    @GetMapping
    public Map<String, Object> version() {
        if (stampPath != null && !stampPath.isBlank()) {
            Path p = Path.of(stampPath);
            if (Files.isReadable(p)) {
                try {
                    return mapper.readValue(Files.readAllBytes(p),
                            new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
                } catch (Exception ignored) {
                    // fall through to unknown
                }
            }
        }
        return Map.of("status", "unknown");
    }
}
