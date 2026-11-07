package com.cgtcalculator.platform.web;

import java.io.IOException;
import java.util.List;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The visitor's address and https, behind Render and Cloudflare. Only when the connection comes from a trusted
 * proxy ({@link ProxyProperties}):
 * <ul>
 * <li>the address is Cloudflare's {@code CF-Connecting-IP} (which Cloudflare always sets itself), else the last
 * {@code X-Forwarded-For} entry that isn't a proxy: entries before it come from the visitor and may be made up;</li>
 * <li>{@code X-Forwarded-Proto: https} makes the request secure, which turns on the HSTS header.</li>
 * </ul>
 * The login and sign-up limits count this address, and the activity log shows it.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ClientAddressFilter extends OncePerRequestFilter {

    private final List<IpAddressMatcher> trusted;
    private final List<IpAddressMatcher> notTrusted;

    public ClientAddressFilter(ProxyProperties properties) {
        trusted = properties.trusted().stream().map(IpAddressMatcher::new).toList();
        notTrusted = properties.notTrusted().stream().map(IpAddressMatcher::new).toList();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isProxy(request.getRemoteAddr())) {
            chain.doFilter(request, response);
            return;
        }
        String client = clientAddress(request);
        String proto = last(request.getHeader("X-Forwarded-Proto"));
        boolean https = proto == null ? request.isSecure() : "https".equalsIgnoreCase(proto);
        chain.doFilter(new Forwarded(request, client, https), response);
    }

    private String clientAddress(HttpServletRequest request) {
        String cloudflare = request.getHeader("CF-Connecting-IP");
        if (cloudflare != null && isAddress(cloudflare.trim())) {
            return cloudflare.trim();
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank()) {
            return request.getRemoteAddr();
        }
        String[] hops = forwarded.split(",");
        String client = request.getRemoteAddr();
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (!isAddress(hop)) break;
            client = hop;
            if (!isProxy(hop)) break;
        }
        return client;
    }

    boolean isProxy(String address) {
        if (address == null || !isAddress(address)) return false;
        return trusted.stream().anyMatch(m -> m.matches(address)) && notTrusted.stream().noneMatch(m -> m.matches(address));
    }

    /** An IPv4 or IPv6 address, not a host name (which IpAddressMatcher would look up). */
    private static boolean isAddress(String text) {
        return !text.isEmpty() && text.length() <= 45 && text.chars().allMatch(c -> Character.digit(c, 16) >= 0 || c == '.' || c == ':');
    }

    private static String last(String header) {
        if (header == null || header.isBlank()) return null;
        String[] values = header.split(",");
        return values[values.length - 1].trim();
    }

    /** The request as the visitor sent it to the proxy. */
    private static final class Forwarded extends HttpServletRequestWrapper {
        private final String address;
        private final boolean https;

        Forwarded(HttpServletRequest request, String address, boolean https) {
            super(request);
            this.address = address;
            this.https = https;
        }

        @Override
        public String getRemoteAddr() {
            return address;
        }

        @Override
        public String getRemoteHost() {
            return address;
        }

        @Override
        public boolean isSecure() {
            return https;
        }

        @Override
        public String getScheme() {
            return https ? "https" : super.getScheme();
        }
    }
}
