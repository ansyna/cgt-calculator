package com.cgtcalculator.platform.web;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.unit.DataSize;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Refuses API request bodies over {@value #MAX_BYTES} bytes (HTTP 413) before anything reads them: the app's forms
 * are a few hundred bytes, and a huge body (say a 60 MB "password") would otherwise be parsed into memory. A few
 * paths may take more ({@link RequestSizeProperties}, e.g. a CSV import's rows).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    static final int MAX_BYTES = 64 * 1024;
    private static final AntPathMatcher PATHS = new AntPathMatcher();
    private static final String TOO_LARGE = "{\"message\":\"The request is too large.\"}";

    private final RequestSizeProperties properties;

    public RequestSizeLimitFilter(RequestSizeProperties properties) {
        this.properties = properties;
    }

    /** The most a request to the path may send: as configured for it (the path, or a pattern such as /api/cgt/*). */
    int limitFor(String path) {
        DataSize larger = properties.largeBodies().get(path);
        if (larger == null) {
            larger = properties.largeBodies().entrySet().stream().filter(e -> e.getKey().contains("*") && PATHS.match(e.getKey(), path))
                    .map(java.util.Map.Entry::getValue).findFirst().orElse(null);
        }
        return larger == null ? MAX_BYTES : (int) Math.min(Integer.MAX_VALUE - 1, larger.toBytes());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        boolean bodyless = "GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method);
        return bodyless || !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        int limit = limitFor(request.getRequestURI());
        long declared = request.getContentLengthLong();
        if (declared > limit) {
            refuse(response);
            return;
        }
        if (declared >= 0) {
            chain.doFilter(request, response);
            return;
        }
        // no length given (chunked): read up to the limit, then hand on what was read
        byte[] body = request.getInputStream().readNBytes(limit + 1);
        if (body.length > limit) {
            refuse(response);
            return;
        }
        chain.doFilter(new ReadBody(request, body), response);
    }

    private static void refuse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.CONTENT_TOO_LARGE.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Connection", "close");
        response.getWriter().write(TOO_LARGE);
    }

    /** The request with its body already read. */
    private static final class ReadBody extends HttpServletRequestWrapper {
        private final byte[] body;

        ReadBody(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() throws IOException {
                    return in.read();
                }

                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    return in.read(b, off, len);
                }

                @Override
                public boolean isFinished() {
                    return in.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException();
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }
}
