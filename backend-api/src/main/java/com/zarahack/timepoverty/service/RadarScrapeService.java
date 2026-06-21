package com.zarahack.timepoverty.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/**
 * On-demand trigger for the Civic Radar AOP scraper (Pillar 3).
 *
 * The scraper normally runs as a standalone bi-weekly service. The admin "force
 * scrape" button shells out to the same Python script in single-shot mode
 * ({@code --once}) so a fresh pass can be requested without waiting two weeks.
 *
 * The run is asynchronous (it hits a slow .gov host and can take minutes): the
 * trigger returns immediately and the UI polls {@link #status()}. A single in-flight
 * run is enforced so repeated clicks can't pile up parallel scrapes against aop.bg.
 */
@Service
public class RadarScrapeService {

    private static final Logger log = LoggerFactory.getLogger(RadarScrapeService.class);

    @Value("${app.radar.scraper.dir:../data-engine}") private String scraperDir;
    @Value("${app.radar.scraper.python:../data-engine/venv/bin/python}") private String python;
    @Value("${app.radar.scraper.script:aop_scraper_service.py}") private String script;

    public enum State { IDLE, RUNNING, SUCCESS, FAILED }

    /** Immutable snapshot of the latest/current run, returned to the admin UI. */
    public record Status(State state, Instant startedAt, Instant finishedAt, String message) {}

    private final AtomicReference<Status> status =
            new AtomicReference<>(new Status(State.IDLE, null, null, null));

    public Status status() { return status.get(); }

    /**
     * Kick off a one-shot scrape if none is in flight.
     * @return the resulting status (RUNNING when started, or the existing RUNNING
     *         status when a scrape was already underway).
     */
    public synchronized Status trigger() {
        Status current = status.get();
        if (current.state() == State.RUNNING) {
            return current;   // already scraping — don't stack a second run
        }
        Status running = new Status(State.RUNNING, Instant.now(), null, null);
        status.set(running);

        Thread worker = new Thread(this::runScrape, "radar-force-scrape");
        worker.setDaemon(true);
        worker.start();
        return running;
    }

    private void runScrape() {
        Instant started = status.get().startedAt();
        File dir = new File(scraperDir);
        try {
            ProcessBuilder pb = new ProcessBuilder(python, script, "--once")
                    .directory(dir)
                    .redirectErrorStream(true);
            // PG* connection vars are inherited from this process's environment.
            log.info("force-scrape started: {} {} --once (cwd={})", python, script, dir.getAbsolutePath());
            Process proc = pb.start();

            StringBuilder tail = new StringBuilder();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    log.info("[scraper] {}", line);
                    tail.append(line).append('\n');
                    if (tail.length() > 2000) tail.delete(0, tail.length() - 2000);
                }
            }
            int code = proc.waitFor();
            if (code == 0) {
                log.info("force-scrape finished OK");
                status.set(new Status(State.SUCCESS, started, Instant.now(), lastLine(tail)));
            } else {
                log.warn("force-scrape exited with code {}", code);
                status.set(new Status(State.FAILED, started, Instant.now(),
                        "Scraper exited with code " + code + ". " + lastLine(tail)));
            }
        } catch (Exception e) {
            log.error("force-scrape failed to run", e);
            status.set(new Status(State.FAILED, started, Instant.now(), e.getMessage()));
        }
    }

    private static String lastLine(StringBuilder out) {
        String s = out.toString().strip();
        if (s.isEmpty()) return null;
        int nl = s.lastIndexOf('\n');
        return nl >= 0 ? s.substring(nl + 1) : s;
    }
}
