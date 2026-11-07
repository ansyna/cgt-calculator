package com.cgtcalculator.platform.web;

import java.io.IOException;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Caching of the React app: the files in /assets have their contents' hash in their name, so a browser can keep
 * them for good; the page itself (index.html, served for every app address) is checked on every visit, so a new
 * deploy is picked up at once instead of an old page asking for files that no longer exist.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
public class StaticCacheFilter extends OncePerRequestFilter {

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/api/") || path.startsWith("/actuator");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean hashed = request.getRequestURI().startsWith("/assets/");
        response.setHeader(HttpHeaders.CACHE_CONTROL, hashed ? "public, max-age=31536000, immutable" : "no-cache");
        chain.doFilter(request, response);
    }
}
