package com.cgtcalculator.platform.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.mail.javamail.JavaMailSender;

import com.cgtcalculator.platform.auth.LimitProperties;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Sessions with refresh cookies, password reset, email confirmation, invitations, approvals and the activity log. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccountIntegrationTest {

    static final String BASE_URL = "https://screener.example";

    record Mail(String to, String subject, String text) {
        String link() {
            Matcher m = Pattern.compile(Pattern.quote(BASE_URL) + "\\S+").matcher(text);
            return m.find() ? m.group() : null;
        }

        String token() {
            return link().substring(link().indexOf("token=") + 6);
        }
    }

    /** Email "on": records messages instead of sending them. */
    static class RecordingMailer extends Mailer {
        final List<Mail> sent = new CopyOnWriteArrayList<>();

        RecordingMailer() {
            super(new ObjectProvider<JavaMailSender>() {
                @Override
                public JavaMailSender getObject() {
                    return null;
                }

                @Override
                public JavaMailSender getObject(Object... args) {
                    return null;
                }

                @Override
                public JavaMailSender getIfAvailable() {
                    return null;
                }

                @Override
                public JavaMailSender getIfUnique() {
                    return null;
                }
            }, new AccountProperties(BASE_URL, "noreply@screener.example", true, 30),
                    new LimitProperties(1000, 1000, 1000, 1000, 1000), Clock.systemUTC());
        }

        @Override
        public boolean isEnabled() {
            return true;
        }

        @Override
        protected boolean deliver(String to, String subject, String text) {
            sent.add(new Mail(to, subject, text));
            return true;
        }

        /** Background emails go out at once (after the transaction), so tests can read them straight away. */
        @Override
        protected void runInBackground(Runnable task) {
            task.run();
        }

        Mail lastTo(String email) {
            return sent.stream().filter(m -> m.to().equalsIgnoreCase(email)).reduce((a, b) -> b).orElseThrow();
        }
    }

    static final class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-10-18T12:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }

        @Bean
        @Primary
        RecordingMailer recordingMailer() {
            return new RecordingMailer();
        }
    }

    @Autowired
    private MockMvc mvc;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private RecordingMailer mailer;
    @Autowired
    private MutableClock clock;

    private static int counter;

    @BeforeEach
    void forward() {
        // a fresh minute for every test: the login throttle counts per minute
        clock.now = clock.now.plus(Duration.ofMinutes(5));
    }

    private static String unique(String name) {
        return name + (++counter) + "-" + System.nanoTime() + "@example.com";
    }

    private MockHttpServletRequestBuilder postJson(String url, Object body) throws Exception {
        return post(url).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
    }

    /** Logs in and returns {token, cookie}. */
    private String[] login(String email, String password) throws Exception {
        MvcResult result = mvc.perform(postJson("/api/auth/login", Map.of("email", email, "password", password)))
                .andExpect(status().isOk()).andReturn();
        return new String[] {json.readTree(result.getResponse().getContentAsString()).get("token").asString(), refreshCookie(result)};
    }

    private static String refreshCookie(MvcResult result) {
        return result.getResponse().getHeaders("Set-Cookie").stream().filter(h -> h.startsWith(SessionService.COOKIE + "="))
                .reduce((a, b) -> b).map(h -> h.substring(SessionService.COOKIE.length() + 1, h.indexOf(';'))).orElse(null);
    }

    private MockHttpServletRequestBuilder refresh(String cookie) {
        return post("/api/auth/refresh").header("X-Requested-With", "fetch")
                .cookie(new jakarta.servlet.http.Cookie(SessionService.COOKIE, cookie));
    }

    private String admin() throws Exception {
        return login("admin@example.com", "admin-password")[0];
    }

    private String register(String email) throws Exception {
        MvcResult result = mvc.perform(postJson("/api/auth/register", Map.of("name", "New Person", "email", email,
                "password", "password123", "passwordConfirmation", "password123"))).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("token").asString();
    }

    private JsonNode getJson(String url, String token) throws Exception {
        return json.readTree(mvc.perform(get(url).header("Authorization", "Bearer " + token)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    void loginSetsAnHttpOnlyRefreshCookieThatRotates() throws Exception {
        MvcResult result = mvc.perform(postJson("/api/auth/login", Map.of("email", "admin@example.com", "password", "admin-password")))
                .andExpect(status().isOk()).andReturn();
        String header = result.getResponse().getHeaders("Set-Cookie").get(0);
        assertThat(header).startsWith("ss_refresh=").contains("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/auth",
                "Max-Age=" + Duration.ofDays(30).toSeconds());
        String cookie = refreshCookie(result);

        // the page asks with its header; a plain cross-site form post can't add it
        mvc.perform(post("/api/auth/refresh").cookie(new jakarta.servlet.http.Cookie(SessionService.COOKIE, cookie)))
                .andExpect(status().isForbidden());
        MvcResult refreshed = mvc.perform(refresh(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value("admin@example.com")).andReturn();
        String next = refreshCookie(refreshed);
        assertThat(next).isNotEqualTo(cookie);
        String token = json.readTree(refreshed.getResponse().getContentAsString()).get("token").asString();
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/refresh").header("X-Requested-With", "fetch")).andExpect(status().isUnauthorized());
    }

    @Test
    void aReplacedTokenUsedAgainEndsThatLogin() throws Exception {
        String first = login("admin@example.com", "admin-password")[1];
        String second = refreshCookie(mvc.perform(refresh(first)).andExpect(status().isOk()).andReturn());
        // a second tab refreshing at the same moment is fine
        mvc.perform(refresh(first)).andExpect(status().isOk());
        // so is trying again after a slow start whose answer never arrived
        clock.now = clock.now.plus(Duration.ofMinutes(3));
        mvc.perform(refresh(first)).andExpect(status().isOk());

        // later, the replaced token comes back: it was copied
        clock.now = clock.now.plus(SessionService.CONCURRENT_REFRESH).plusSeconds(1);
        mvc.perform(refresh(first)).andExpect(status().isUnauthorized());
        // ... and the legitimate newer token stops working too
        mvc.perform(refresh(second)).andExpect(status().isUnauthorized());
        assertThat(getJson("/api/activity?type=session", admin()).get("content").get(0).get("action").asString())
                .isEqualTo("session.reuse-detected");
    }

    @Test
    void logoutEndsTheLogin() throws Exception {
        String cookie = login("admin@example.com", "admin-password")[1];
        MvcResult out = mvc.perform(post("/api/auth/logout").header("X-Requested-With", "fetch")
                .cookie(new jakarta.servlet.http.Cookie(SessionService.COOKIE, cookie))).andExpect(status().isNoContent()).andReturn();
        assertThat(out.getResponse().getHeader("Set-Cookie")).contains("Max-Age=0");
        mvc.perform(refresh(cookie)).andExpect(status().isUnauthorized());
    }

    @Test
    void forgottenPasswordByEmail() throws Exception {
        String email = unique("forgot");
        register(email);
        String oldCookie = login(email, "password123")[1];

        // the same answer for unknown addresses; nothing is sent to them
        String unknown = unique("nobody");
        mvc.perform(postJson("/api/auth/password/forgot", Map.of("email", unknown))).andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value(AccountController.RESET_SENT));
        assertThat(mailer.sent).noneMatch(m -> m.to().equals(unknown));

        mvc.perform(postJson("/api/auth/password/forgot", Map.of("email", email))).andExpect(status().isOk());
        Mail mail = mailer.lastTo(email);
        assertThat(mail.subject()).contains("reset your password");
        assertThat(mail.link()).startsWith(BASE_URL + "/reset-password?token=");

        mvc.perform(postJson("/api/auth/password/reset", Map.of("token", mail.token(), "password", "short", "passwordConfirmation", "short")))
                .andExpect(status().isUnprocessableContent());
        mvc.perform(postJson("/api/auth/password/reset", Map.of("token", mail.token(), "password", "new-password-1",
                "passwordConfirmation", "new-password-1"))).andExpect(status().isNoContent());
        // single use
        mvc.perform(postJson("/api/auth/password/reset", Map.of("token", mail.token(), "password", "new-password-2",
                "passwordConfirmation", "new-password-2"))).andExpect(status().isBadRequest());

        login(email, "new-password-1");
        mvc.perform(postJson("/api/auth/login", Map.of("email", email, "password", "password123"))).andExpect(status().isUnauthorized());
        // logins made with the old password are ended
        mvc.perform(refresh(oldCookie)).andExpect(status().isUnauthorized());
    }

    @Test
    void resetLinksExpireAfterAnHour() throws Exception {
        String email = unique("expire");
        register(email);
        mvc.perform(postJson("/api/auth/password/forgot", Map.of("email", email))).andExpect(status().isOk());
        String token = mailer.lastTo(email).token();
        clock.now = clock.now.plus(Duration.ofMinutes(61));
        mvc.perform(postJson("/api/auth/password/reset", Map.of("token", token, "password", "new-password-1",
                "passwordConfirmation", "new-password-1"))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("expired")));
    }

    @Test
    void resetRequestsAreLimited() throws Exception {
        String email = unique("limited");
        for (int i = 0; i < 5; i++) {
            mvc.perform(postJson("/api/auth/password/forgot", Map.of("email", email))).andExpect(status().isOk());
        }
        mvc.perform(postJson("/api/auth/password/forgot", Map.of("email", email))).andExpect(status().isTooManyRequests());
    }

    @Test
    void signUpsConfirmTheirEmailAndWaitForApproval() throws Exception {
        String email = unique("signup");
        String token = register(email);
        assertThat(getJson("/api/auth/me", token).get("emailVerified").asBoolean()).isFalse();
        Mail confirm = mailer.lastTo(email);
        assertThat(confirm.link()).startsWith(BASE_URL + "/verify-email?token=");
        // admins hear about it
        assertThat(mailer.lastTo("admin@example.com").subject()).contains("signed up");

        mvc.perform(postJson("/api/auth/email/verify", Map.of("token", confirm.token()))).andExpect(status().isNoContent());
        assertThat(getJson("/api/auth/me", token).get("emailVerified").asBoolean()).isTrue();

        String admin = admin();
        JsonNode pending = getJson("/api/users/pending", admin);
        JsonNode mine = null;
        for (JsonNode user : pending) if (user.get("email").asString().equals(email)) mine = user;
        assertThat(mine).isNotNull();

        mvc.perform(post("/api/users/" + mine.get("id").asLong() + "/approve").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.roles[0]").value("investor"));
        assertThat(mailer.lastTo(email).subject()).contains("your account is ready");
        assertThat(getJson("/api/users/pending", admin).findValuesAsString("email")).doesNotContain(email);
        // the new role applies at once
        mvc.perform(get("/api/cgt/transactions").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
    }

    @Test
    void invitationsLetThePersonChooseTheirPassword() throws Exception {
        String admin = admin();
        String email = unique("invitee");
        JsonNode invite = json.readTree(mvc.perform(postJson("/api/users/invitations", Map.of("email", email, "name", "Ivy",
                "roles", List.of("investor"))).header("Authorization", "Bearer " + admin)).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        assertThat(invite.get("emailed").asBoolean()).isTrue();
        assertThat(invite.get("user").get("invitationPending").asBoolean()).isTrue();
        assertThat(invite.get("url").asString()).startsWith(BASE_URL + "/accept-invite?token=");
        Mail mail = mailer.lastTo(email);
        assertThat(mail.subject()).isEqualTo("Test Admin invited you to CGT Calculator");

        // no usable password until accepted
        mvc.perform(postJson("/api/auth/login", Map.of("email", email, "password", ""))).andExpect(status().isUnprocessableContent());
        mvc.perform(get("/api/auth/invitation").param("token", mail.token())).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email)).andExpect(jsonPath("$.name").value("Ivy"));
        MvcResult accepted = mvc.perform(postJson("/api/auth/invitation/accept", Map.of("token", mail.token(), "name", "Ivy Investor",
                "password", "password123", "passwordConfirmation", "password123"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.user.roles[0]").value("investor")).andReturn();
        assertThat(refreshCookie(accepted)).isNotBlank();
        login(email, "password123");

        // already a member: no second invitation
        mvc.perform(postJson("/api/users/invitations", Map.of("email", email, "roles", List.of("investor")))
                .header("Authorization", "Bearer " + admin)).andExpect(status().isUnprocessableContent());
    }

    @Test
    void adminsCanCreateAResetLinkToPassOn() throws Exception {
        String email = unique("forgetful");
        register(email);
        String admin = admin();
        long id = getJson("/api/users/pending", admin).findValues("email").stream().filter(e -> e.asString().equals(email)).count();
        assertThat(id).isOne();
        long userId = 0;
        for (JsonNode user : getJson("/api/users/pending", admin)) if (user.get("email").asString().equals(email)) userId = user.get("id").asLong();
        JsonNode link = json.readTree(mvc.perform(post("/api/users/" + userId + "/password-reset").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(link.get("path").asString()).startsWith("/reset-password?token=");
        assertThat(link.get("url").asString()).isEqualTo(BASE_URL + link.get("path").asString());
    }

    @Test
    void theActivityLogRecordsWhoDidWhat() throws Exception {
        String admin = admin();
        mvc.perform(postJson("/api/auth/login", Map.of("email", "admin@example.com", "password", "wrong"))
                .with(request -> {
                    request.setRemoteAddr("203.0.113.5");
                    return request;
                })).andExpect(status().isUnauthorized());
        // the visitor's address (ForwardedHeadersTest: as Render's proxy passes it on); other tests share the database
        JsonNode login = getJson("/api/activity?type=login&size=100", admin).get("content").findParents("ip").stream()
                .filter(e -> e.get("ip").asString().equals("203.0.113.5")).findFirst().orElseThrow();
        assertThat(login.get("action").asString()).isEqualTo("login.failed");
        assertThat(login.get("target").asString()).isEqualTo("admin@example.com");

        String email = unique("edited");
        mvc.perform(postJson("/api/users", Map.of("name", "Edited", "email", email, "password", "password123",
                "confirmPassword", "password123", "roles", List.of("investor"))).header("Authorization", "Bearer " + admin))
                .andExpect(status().isCreated());
        long id = getJson("/api/users?size=100", admin).get("content").findParents("email").stream()
                .filter(u -> u.get("email").asString().equals(email)).findFirst().orElseThrow().get("id").asLong();
        mvc.perform(put("/api/users/" + id).contentType(MediaType.APPLICATION_JSON).header("Authorization", "Bearer " + admin)
                .content(json.writeValueAsString(Map.of("name", "Edited", "email", email, "roles", List.of("admin")))))
                .andExpect(status().isOk());
        // this user's entries, newest first: other tests share the database, some with other clocks
        List<JsonNode> users = getJson("/api/activity?type=user&size=100", admin).get("content").findParents("target").stream()
                .filter(e -> e.get("target").asString().equals(email)).toList();
        assertThat(users).hasSize(2);
        assertThat(users.get(0).get("action").asString()).isEqualTo("user.updated");
        assertThat(users.get(0).get("actor").asString()).isEqualTo("admin@example.com");
        assertThat(users.get(0).get("details").asString()).isEqualTo("roles: admin");
        assertThat(users.get(1).get("action").asString()).isEqualTo("user.created");

        // admins only
        String investor = register(unique("curious"));
        mvc.perform(get("/api/activity").header("Authorization", "Bearer " + investor)).andExpect(status().isForbidden());
    }

    @Test
    void theAppKnowsEmailIsOn() throws Exception {
        mvc.perform(get("/api/config")).andExpect(jsonPath("$.mailEnabled").value(true));
    }
}
