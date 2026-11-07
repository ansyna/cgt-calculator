package com.cgtcalculator.platform.account;

import java.time.Clock;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;


/**
 * Records who did what for the admin activity log; entries are kept for {@link #RETENTION}, and at most the newest
 * {@link #MAX_ENTRIES} (failed logins from scripts could otherwise fill the database).
 */
@Service
public class ActivityService {

    static final Duration RETENTION = Duration.ofDays(180);
    static final int MAX_ENTRIES = 100_000;

    private static final Logger log = LoggerFactory.getLogger(ActivityService.class);

    private final ActivityRepository repository;
    private final Clock clock;

    public ActivityService(ActivityRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /** @param actor email of who did it, "" for someone not logged in */
    public void record(String action, String actor, String target, String details) {
        try {
            repository.save(new ActivityEntry(clock.instant(), nullToEmpty(actor), action, nullToEmpty(target),
                    nullToEmpty(details), clientAddress()));
        } catch (RuntimeException e) {
            // the log must never break what it records
            log.warn("Could not record activity {}: {}", action, e.getMessage());
        }
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT10M")
    public void deleteOldEntries() {
        repository.deleteOlderThan(clock.instant().minus(RETENTION));
        // the newest entry beyond the cap: it and everything older go
        repository.findAllByOrderByAtDescIdDesc(PageRequest.of(MAX_ENTRIES, 1)).stream().findFirst()
                .ifPresent(oldestKept -> repository.deleteUpTo(oldestKept.getAt(), oldestKept.getId()));
    }

    /**
     * The visitor's address, as the login limits see it: Tomcat takes it from the X-Forwarded-For entry that
     * Render's proxy appended (server.forward-headers-strategy); entries before it come from the visitor.
     */
    static String clientAddress() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) {
            return "";
        }
        String address = attributes.getRequest().getRemoteAddr();
        return address == null ? "" : address.length() > 255 ? address.substring(0, 255) : address;
    }

    private static String nullToEmpty(String text) {
        return text == null ? "" : text;
    }
}
