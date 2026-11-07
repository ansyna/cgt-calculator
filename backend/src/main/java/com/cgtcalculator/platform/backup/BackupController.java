package com.cgtcalculator.platform.backup;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.cgtcalculator.platform.account.ActivityService;
import com.cgtcalculator.platform.auth.RateLimiter;
import com.cgtcalculator.platform.auth.RequestLimits;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The monthly backup (.github/workflows/backup.yml) downloads the data here: the database itself accepts no
 * connections from the internet. Only with the secret BACKUP_TOKEN in X-Backup-Token; off without one.
 */
@RestController
public class BackupController {

    public static final String TOKEN_HEADER = "X-Backup-Token";

    private static final Logger log = LoggerFactory.getLogger(BackupController.class);

    private final BackupService backup;
    private final BackupProperties properties;
    private final ActivityService activity;
    // a few wrong tokens an hour per address: guessing a 32+ character secret is hopeless anyway
    private final RateLimiter attempts;

    public BackupController(BackupService backup, BackupProperties properties, ActivityService activity, Clock clock) {
        this.backup = backup;
        this.properties = properties;
        this.activity = activity;
        this.attempts = new RateLimiter(10, Duration.ofHours(1), clock);
        if (properties.token() != null && !properties.token().isEmpty() && !properties.enabled()) {
            log.warn("BACKUP_TOKEN is shorter than {} characters: the backup endpoint stays off", BackupProperties.MIN_TOKEN_LENGTH);
        }
    }

    @GetMapping("/api/backup")
    public void download(@RequestHeader(name = TOKEN_HEADER, required = false) String token, HttpServletRequest request,
                         HttpServletResponse response) throws IOException {
        if (!properties.enabled()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        RequestLimits.require(attempts.acquire(request.getRemoteAddr()), "Too many attempts.");
        if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                properties.token().getBytes(StandardCharsets.UTF_8))) {
            activity.record("backup.refused", "", "", "Wrong or missing backup token");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong backup token.");
        }
        response.setContentType("application/sql; charset=UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Disposition", "attachment; filename=\"backup.sql\"");
        Writer out = new OutputStreamWriter(response.getOutputStream(), StandardCharsets.UTF_8);
        int rows = backup.write(out);
        activity.record("backup.downloaded", "", "", rows + " rows");
    }
}
