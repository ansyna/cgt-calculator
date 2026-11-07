package com.cgtcalculator.platform.web;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Which connections come from a proxy in front of the app, whose forwarded headers say who the visitor is.
 *
 * @param trusted    address ranges of the proxies (CIDR): the private network (Render's own) and Cloudflare, which
 *                   Render puts in front of every app
 * @param notTrusted ranges inside {@code trusted} that are visitors, not proxies (Cloudflare's WARP VPN gives its
 *                   users addresses from Cloudflare's ranges)
 */
@ConfigurationProperties(prefix = "app.proxies")
public record ProxyProperties(List<String> trusted, List<String> notTrusted) {

    public ProxyProperties {
        trusted = trusted == null ? List.of() : List.copyOf(trusted);
        notTrusted = notTrusted == null ? List.of() : List.copyOf(notTrusted);
    }
}
