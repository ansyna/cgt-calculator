package com.cgtcalculator.platform.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.ObjectMapper;

/** What anyone can send without logging in is limited: body size, password length, attempts per address. */
@SpringBootTest(properties = {
        "app.limits.logins-per-address-per-minute=3",
        "app.limits.sign-ups-per-address-per-hour=2"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RequestLimitsTest {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private ObjectMapper json;

    private MockHttpServletRequestBuilder postJson(String url, Object body, String address) throws Exception {
        return post(url).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))
                .with(request -> {
                    request.setRemoteAddr(address);
                    return request;
                });
    }

    @Test
    void hugeBodiesAreRefusedBeforeAnythingReadsThem() throws Exception {
        String password = "x".repeat(70 * 1024);
        mvc.perform(postJson("/api/auth/login", Map.of("email", "a@example.com", "password", password), "9.0.0.1"))
                .andExpect(status().isContentTooLarge())
                .andExpect(jsonPath("$.message").value("The request is too large."));
    }

    @Test
    void malformedJsonIsTheClientsMistake() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("The request is malformed."));
    }

    @Test
    void passwordsLongerThanBcryptCanCheck() throws Exception {
        // 100 accented letters: 200 bytes, more than bcrypt's 72
        String longPassword = "é".repeat(100);
        mvc.perform(postJson("/api/auth/login", Map.of("email", "admin@example.com", "password", longPassword), "9.0.0.2"))
                .andExpect(status().isUnauthorized());
        mvc.perform(postJson("/api/auth/register", Map.of("name", "Long", "email", "long@example.com",
                        "password", longPassword, "passwordConfirmation", longPassword), "9.0.0.2"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.password[0]").value(org.hamcrest.Matchers.startsWith("The password must be at most 72 bytes")));
        // fields have a maximum length
        mvc.perform(postJson("/api/auth/login", Map.of("email", "admin@example.com", "password", "p".repeat(300)), "9.0.0.2"))
                .andExpect(status().isUnprocessableContent());
    }

    @Test
    void loginsPerAddressAreLimitedWithoutLockingOthersOut() throws Exception {
        Map<String, String> wrong = Map.of("email", "admin@example.com", "password", "wrong-password");
        for (int i = 0; i < 3; i++) {
            mvc.perform(postJson("/api/auth/login", wrong, "9.0.0.3")).andExpect(status().isUnauthorized());
        }
        mvc.perform(postJson("/api/auth/login", wrong, "9.0.0.3"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.startsWith("Too many login attempts. Please try again in")));
        // the admin elsewhere still logs in
        mvc.perform(postJson("/api/auth/login", Map.of("email", "admin@example.com", "password", "admin-password"), "9.0.0.4"))
                .andExpect(status().isOk());
    }

    @Test
    void signUpsPerAddressAreLimited() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(postJson("/api/auth/register", Map.of("name", "Person", "email", "person" + i + "@example.com",
                    "password", "password123", "passwordConfirmation", "password123"), "9.0.0.5")).andExpect(status().isCreated());
        }
        mvc.perform(postJson("/api/auth/register", Map.of("name", "Person", "email", "person9@example.com",
                        "password", "password123", "passwordConfirmation", "password123"), "9.0.0.5"))
                .andExpect(status().isTooManyRequests());
    }
}
