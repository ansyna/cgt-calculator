package com.cgtcalculator.platform.backup;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param token the secret the monthly backup job sends in X-Backup-Token (BACKUP_TOKEN, at least 32 characters);
 *              without it the backup endpoint is off
 */
@ConfigurationProperties(prefix = "app.backup")
public record BackupProperties(String token) {

    static final int MIN_TOKEN_LENGTH = 32;

    boolean enabled() {
        return token != null && token.length() >= MIN_TOKEN_LENGTH;
    }
}
