package com.cgtcalculator.platform.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Limits on what anyone can do without logging in, against scripts.
 *
 * @param loginsPerAddressPerMinute      login attempts from one address, for any accounts
 * @param signUpsPerAddressPerHour       sign-ups from one address
 * @param resetRequestsPerAddressPerHour forgotten-password requests from one address
 * @param emailsPerAddressPerHour        reset or confirmation links asked for one email address
 * @param emailsPerRecipientPerDay       emails the app sends to one address, whatever the reason
 */
@ConfigurationProperties(prefix = "app.limits")
public record LimitProperties(int loginsPerAddressPerMinute, int signUpsPerAddressPerHour, int resetRequestsPerAddressPerHour,
                              int emailsPerAddressPerHour, int emailsPerRecipientPerDay) {
}
