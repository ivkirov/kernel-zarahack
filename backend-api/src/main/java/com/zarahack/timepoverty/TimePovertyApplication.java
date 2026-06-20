package com.zarahack.timepoverty;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
@EnableCaching   // in-memory cache for the heavy /matrix computation (keyed by district)
public class TimePovertyApplication {
    public static void main(String[] args) {
        SpringApplication.run(TimePovertyApplication.class, args);
    }

    // Simple in-memory cache (no extra dependency); fine for a single-node local demo.
    @Bean
    public CacheManager cacheManager() {
        return new ConcurrentMapCacheManager("matrix");
    }
}
