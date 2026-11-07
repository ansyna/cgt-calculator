package com.cgtcalculator.platform.account;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param baseUrl       public address of the app, for links in emails (APP_BASE_URL, or Render's RENDER_EXTERNAL_URL)
 * @param mailFrom      sender of the app's emails (MAIL_FROM)
 * @param cookieSecure  send the login cookie over HTTPS only (COOKIE_SECURE; false only for plain-http hosting)
 * @param refreshDays   how long a login lasts without being used
 */
@ConfigurationProperties(prefix = "app.account")
public record AccountProperties(String baseUrl, String mailFrom, boolean cookieSecure, int refreshDays) {
}
