package com.cgtcalculator.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

import com.cgtcalculator.platform.account.ActivityEntry;
import com.cgtcalculator.platform.account.ActivityRepository;

/**
 * Behind Render's proxy the visitor's address and https arrive in X-Forwarded-* headers. On a real server
 * (MockMvc skips Tomcat), they must be used when they come from a private-network proxy, and only the address the
 * proxy appended counts.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ForwardedHeadersTest {

    @LocalServerPort
    private int port;
    @Autowired
    private ActivityRepository activity;

    private HttpResponse<String> post(String path, String body, String forwardedFor) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .header("X-Forwarded-For", forwardedFor)
                .header("X-Forwarded-Proto", "https")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }

    @Test
    void theVisitorsAddressAndHttpsComeFromTheProxy() throws Exception {
        // the first address is made up by the visitor; the proxy appended the real one
        HttpResponse<String> response = post("/api/auth/login", "{\"email\":\"forwarded@example.com\",\"password\":\"wrong-password\"}",
                "1.2.3.4, 203.0.113.7");
        assertThat(response.statusCode()).isEqualTo(401);
        // https as far as the app knows: browsers are told to stay on https
        assertThat(response.headers().firstValue("Strict-Transport-Security")).isPresent();

        ActivityEntry failed = activity.findAllByOrderByAtDescIdDesc(PageRequest.of(0, 20)).stream()
                .filter(e -> e.getTarget().equals("forwarded@example.com")).findFirst().orElseThrow();
        assertThat(failed.getIp()).isEqualTo("203.0.113.7");
    }
}
