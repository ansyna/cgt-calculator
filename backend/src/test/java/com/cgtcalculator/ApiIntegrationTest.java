package com.cgtcalculator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIntegrationTest {

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-10-18T12:00:00Z"), ZoneId.of("UTC"));
        }
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String login(String email, String password) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", email, "password", password))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("token").asString();
    }

    private String register(String email) throws Exception {
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "New User", "email", email, "password", "password123",
                                "passwordConfirmation", "password123"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("token").asString();
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, String token) {
        return request.header("Authorization", "Bearer " + token);
    }

    private JsonNode getJson(String url, String token) throws Exception {
        String body = mvc.perform(auth(get(url), token)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    @Test
    void publicConfigAndAuthentication() throws Exception {
        mvc.perform(get("/api/config")).andExpect(status().isOk())
                .andExpect(jsonPath("$.contactEmail").value("admin@example.com"));
        mvc.perform(get("/api/cgt/transactions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "admin@example.com", "password", "wrong"))))
                .andExpect(status().isUnauthorized());

        String token = login("admin@example.com", "admin-password");
        mvc.perform(auth(get("/api/auth/me"), token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.roles[0]").value("admin"))
                .andExpect(jsonPath("$.permissions.length()").value(9));
    }

    @Test
    void loginsAreThrottledPerEmailAndAddress() throws Exception {
        register("throttled@example.com");
        for (int i = 0; i < 5; i++) {
            mvc.perform(loginFrom("10.0.0.9", "throttled@example.com", "wrong")).andExpect(status().isUnauthorized());
        }
        // from that address, even the right password waits (30 s, then longer after each failure)
        mvc.perform(loginFrom("10.0.0.9", "Throttled@example.com", "password123"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.message").value("Too many failed logins. Please try again in 30 seconds."));
        // other addresses and other accounts are unaffected
        mvc.perform(loginFrom("10.0.0.10", "throttled@example.com", "password123")).andExpect(status().isOk());
        mvc.perform(loginFrom("10.0.0.9", "admin@example.com", "admin-password")).andExpect(status().isOk());
    }

    private MockHttpServletRequestBuilder loginFrom(String address, String email, String password) throws Exception {
        return post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("email", email, "password", password)))
                .with(request -> {
                    request.setRemoteAddr(address);
                    return request;
                });
    }

    @Test
    void registeredUsersNeedARoleForInvestingTools() throws Exception {
        String token = register("newcomer@example.com");
        mvc.perform(auth(get("/api/auth/me"), token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.roles.length()").value(0));
        mvc.perform(auth(get("/api/cgt/transactions"), token)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/users"), token)).andExpect(status().isForbidden());

        // admin grants the investor role; the existing token picks it up immediately
        String admin = login("admin@example.com", "admin-password");
        JsonNode users = getJson("/api/users?size=100", admin);
        long id = 0;
        for (JsonNode user : users.get("content")) {
            if (user.get("email").asString().equals("newcomer@example.com")) {
                id = user.get("id").asLong();
            }
        }
        mvc.perform(auth(put("/api/users/" + id), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "New User", "email", "newcomer@example.com",
                                "roles", List.of("investor")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles[0]").value("investor"));

        mvc.perform(auth(get("/api/cgt/transactions"), token)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users"), token)).andExpect(status().isForbidden());
    }

    @Test
    void registrationValidation() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "X", "email", "admin@example.com", "password", "password123",
                                "passwordConfirmation", "password123"))))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.email[0]").value("The email has already been taken."));
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "X", "email", "x@example.com", "password", "short",
                                "passwordConfirmation", "short"))))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.password").exists());
    }

    @Test
    void userAndRoleManagement() throws Exception {
        String admin = login("admin@example.com", "admin-password");

        JsonNode permissions = getJson("/api/permissions", admin);
        assertThat(permissions).hasSize(9);
        long viewToolsId = 0;
        for (JsonNode permission : permissions) {
            if (permission.get("name").asString().equals("view-investing-tools")) {
                viewToolsId = permission.get("id").asLong();
            }
        }

        String roleBody = mvc.perform(auth(post("/api/roles"), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "analyst", "permission", List.of(viewToolsId)))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        long roleId = objectMapper.readTree(roleBody).get("id").asLong();

        mvc.perform(auth(post("/api/roles"), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "analyst", "permission", List.of(viewToolsId)))))
                .andExpect(status().isUnprocessableContent());

        String userBody = mvc.perform(auth(post("/api/users"), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Ann", "email", "ann@example.com", "password", "password123",
                                "confirmPassword", "password123", "roles", List.of("analyst")))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.roles[0]").value("analyst"))
                .andReturn().getResponse().getContentAsString();
        long userId = objectMapper.readTree(userBody).get("id").asLong();

        mvc.perform(auth(post("/api/users"), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Bob", "email", "bob@example.com", "password", "password123",
                                "confirmPassword", "different", "roles", List.of("analyst")))))
                .andExpect(status().isUnprocessableContent());

        // deleting a role detaches it from its users
        mvc.perform(auth(delete("/api/roles/" + roleId), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/" + userId), admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$.roles.length()").value(0));

        long adminRoleId = 0;
        for (JsonNode role : getJson("/api/roles?size=100", admin).get("content")) {
            if (role.get("name").asString().equals("admin")) {
                adminRoleId = role.get("id").asLong();
            }
        }
        mvc.perform(auth(delete("/api/roles/" + adminRoleId), admin)).andExpect(status().isBadRequest());

        mvc.perform(auth(delete("/api/users/" + userId), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/" + userId), admin)).andExpect(status().isNotFound());
    }

    @Test
    void adminsCannotLockThemselvesOut() throws Exception {
        String admin = login("admin@example.com", "admin-password");
        JsonNode me = getJson("/api/auth/me", admin);

        mvc.perform(auth(put("/api/users/" + me.get("id").asLong()), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Test Admin", "email", "admin@example.com", "roles", List.of("investor")))))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.roles[0]").value("You cannot remove the admin role from your own account."));

        long adminRoleId = 0;
        long viewToolsId = 0;
        for (JsonNode role : getJson("/api/roles?size=100", admin).get("content")) {
            if (role.get("name").asString().equals("admin")) {
                adminRoleId = role.get("id").asLong();
            }
        }
        for (JsonNode permission : getJson("/api/permissions", admin)) {
            if (permission.get("name").asString().equals("view-investing-tools")) {
                viewToolsId = permission.get("id").asLong();
            }
        }
        mvc.perform(auth(put("/api/roles/" + adminRoleId), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "admin", "permission", List.of(viewToolsId)))))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.permission[0]").value("The admin role must keep all permissions."));

        // still an admin with every permission
        mvc.perform(auth(get("/api/auth/me"), admin)).andExpect(jsonPath("$.permissions.length()").value(9));
    }

    @Test
    void tokensAreValidated() throws Exception {
        String admin = login("admin@example.com", "admin-password");
        String tampered = admin.substring(0, admin.length() - 4) + (admin.endsWith("AAAA") ? "BBBB" : "AAAA");
        mvc.perform(auth(get("/api/auth/me"), tampered)).andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/auth/me"), "not-a-jwt")).andExpect(status().isUnauthorized());

        // a deleted user's token stops working immediately
        String token = register("short-lived@example.com");
        long id = getJson("/api/auth/me", token).get("id").asLong();
        mvc.perform(auth(delete("/api/users/" + id), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/auth/me"), token)).andExpect(status().isUnauthorized());
    }

    @Test
    void investorsCannotManageUsersOrRoles() throws Exception {
        String admin = login("admin@example.com", "admin-password");
        String token = register("investor@example.com");
        long id = getJson("/api/auth/me", token).get("id").asLong();
        mvc.perform(auth(put("/api/users/" + id), admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Investor", "email", "investor@example.com", "roles", List.of("investor")))))
                .andExpect(status().isOk());

        mvc.perform(auth(get("/api/cgt/transactions"), token)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/roles"), token)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/permissions"), token)).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/users/" + id), token)).andExpect(status().isForbidden());
    }

    @Test
    void withoutEmailAdminsShareLinksThemselves() throws Exception {
        mvc.perform(get("/api/config")).andExpect(jsonPath("$.mailEnabled").value(false));
        mvc.perform(post("/api/auth/password/forgot").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "admin@example.com"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("ask the admin")));

        // sign-ups aren't asked to confirm an address the app can't write to
        String newcomer = register("no-mail@example.com");
        mvc.perform(auth(get("/api/auth/me"), newcomer)).andExpect(jsonPath("$.emailVerified").value(true));

        String admin = login("admin@example.com", "admin-password");
        JsonNode pending = getJson("/api/users/pending", admin);
        long id = pending.findParents("email").stream().filter(u -> u.get("email").asString().equals("no-mail@example.com"))
                .findFirst().orElseThrow().get("id").asLong();
        JsonNode link = objectMapper.readTree(mvc.perform(auth(post("/api/users/" + id + "/password-reset"), admin))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(link.get("emailed").asBoolean()).isFalse();
        assertThat(link.get("url").isNull()).isTrue();
        String token = link.get("path").asString().substring("/reset-password?token=".length());
        mvc.perform(post("/api/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("token", token, "password", "brand-new-pass", "passwordConfirmation", "brand-new-pass"))))
                .andExpect(status().isNoContent());
        login("no-mail@example.com", "brand-new-pass");
    }

    @Test
    void healthChecksAreOpenAndShowNoDetails() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/info")).andExpect(status().isOk());
        // nothing else is exposed
        mvc.perform(get("/actuator")).andExpect(result -> assertThat(result.getResponse().getContentAsString()).doesNotContain("env"));
    }

    @Test
    void everyResponseCarriesARequestId() throws Exception {
        String generated = mvc.perform(get("/api/config")).andExpect(status().isOk())
                .andExpect(jsonPath("$.sentry.dsn").value(""))
                .andReturn().getResponse().getHeader("X-Request-Id");
        assertThat(generated).matches("[0-9a-f]{12}");
        // a caller's id is kept when it is plain
        assertThat(mvc.perform(get("/api/config").header("X-Request-Id", "abc-123")).andReturn().getResponse().getHeader("X-Request-Id"))
                .isEqualTo("abc-123");
        assertThat(mvc.perform(get("/api/config").header("X-Request-Id", "<script>")).andReturn().getResponse().getHeader("X-Request-Id"))
                .matches("[0-9a-f]{12}");
    }
}
