package com.cgtcalculator.platform.auth;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.cgtcalculator.platform.account.AccountEmails;
import com.cgtcalculator.platform.account.AccountService;
import com.cgtcalculator.platform.account.Passwords;
import com.cgtcalculator.platform.account.ActivityService;
import com.cgtcalculator.platform.account.SessionService;
import com.cgtcalculator.platform.account.SessionService.Session;
import com.cgtcalculator.platform.config.AppProperties;
import com.cgtcalculator.platform.monitoring.MonitoringProperties;
import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;
import com.cgtcalculator.platform.auth.RateLimiter.Decision;
import com.cgtcalculator.platform.web.ApiExceptionHandler.TooManyRequestsException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api")
public class AuthController {

    /**
     * Header the app sends with the cookie-based calls (refresh, logout). Other sites can't add it to a request
     * without CORS permission, on top of the cookie's SameSite=Strict.
     */
    public static final String CSRF_HEADER = "X-Requested-With";

    public record LoginRequest(@NotBlank @Email @Size(max = 255) String email, @NotBlank @Size(max = 255) String password) {
    }

    public record RegisterRequest(
            @NotBlank @Size(max = 255) String name,
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(max = 255) String password,
            @NotBlank @Size(max = 255) String passwordConfirmation) {
    }

    /** @param emailVerified false only while a sign-up hasn't confirmed its address */
    public record CurrentUser(Long id, String name, String email, List<String> roles, List<String> permissions,
                              boolean emailVerified) {

        public static CurrentUser of(User user) {
            return new CurrentUser(user.getId(), user.getName(), user.getEmail(),
                    user.getRoles().stream().map(r -> r.getName()).toList(),
                    user.getRoles().stream().flatMap(r -> r.getPermissions().stream())
                            .map(p -> p.getName()).distinct().toList(),
                    user.isEmailVerified());
        }
    }

    /** The access token (kept in the page's memory); the refresh token travels in an HttpOnly cookie. */
    public record AuthResponse(String token, CurrentUser user) {
    }

    private final UserRepository userRepository;
    private final AccountService accounts;
    private final AppProperties properties;
    private final LoginThrottle throttle;
    private final RequestLimits limits;
    private final SessionService sessions;
    private final AccountEmails emails;
    private final ActivityService activity;
    private final MonitoringProperties monitoring;

    public AuthController(UserRepository userRepository, AccountService accounts, AppProperties properties,
                          LoginThrottle throttle, RequestLimits limits, SessionService sessions, AccountEmails emails,
                          ActivityService activity, MonitoringProperties monitoring) {
        this.userRepository = userRepository;
        this.accounts = accounts;
        this.properties = properties;
        this.throttle = throttle;
        this.limits = limits;
        this.sessions = sessions;
        this.emails = emails;
        this.activity = activity;
        this.monitoring = monitoring;
    }

    @PostMapping("/auth/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest http, HttpServletResponse response) {
        // the visitor's address: Render's proxy passes it on (server.forward-headers-strategy)
        String address = http.getRemoteAddr();
        String email = request.email().trim();
        Decision fromAddress = limits.login(address);
        if (fromAddress.firstRefusal()) {
            activity.record("login.limited", "", email, "Too many logins from one address: refused for a while");
        }
        RequestLimits.require(fromAddress, "Too many login attempts.");
        long locked = throttle.secondsLocked(email, address);
        if (locked > 0) {
            throw new TooManyRequestsException("Too many failed logins.", locked);
        }
        User user = accounts.authenticate(email, request.password()).orElse(null);
        if (user == null) {
            boolean startsWaiting = throttle.failed(email, address);
            activity.record("login.failed", "", email, "Wrong email or password");
            if (startsWaiting) {
                activity.record("login.throttled", "", email, "Too many failed logins: further attempts must wait");
            }
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "These credentials do not match our records.");
        }
        throttle.succeeded(email, address);
        activity.record("login", user.getEmail(), user.getEmail(), "");
        return new AuthResponse(sessions.start(user, response), CurrentUser.of(user));
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@Valid @RequestBody RegisterRequest request, HttpServletRequest http, HttpServletResponse response) {
        Passwords.validate(request.password(), request.passwordConfirmation(), "The password confirmation does not match.");
        limits.signUp(http.getRemoteAddr());
        User user = accounts.register(request.name(), request.email(), request.password());
        return new AuthResponse(sessions.start(user, response), CurrentUser.of(user));
    }

    /** Exchanges the refresh cookie for a new access token (and a new cookie). */
    @PostMapping("/auth/refresh")
    // SessionService.refresh keeps the ending of a copied login although the request is refused
    public AuthResponse refresh(@CookieValue(name = SessionService.COOKIE, required = false) String cookie,
                                @RequestHeader(name = CSRF_HEADER, required = false) String requestedWith,
                                HttpServletResponse response) {
        requireAppRequest(requestedWith);
        Session session = sessions.refresh(cookie, response);
        return new AuthResponse(session.accessToken(), CurrentUser.of(session.user()));
    }

    @PostMapping("/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@CookieValue(name = SessionService.COOKIE, required = false) String cookie,
                       @RequestHeader(name = CSRF_HEADER, required = false) String requestedWith,
                       HttpServletResponse response) {
        requireAppRequest(requestedWith);
        User user = sessions.end(cookie, response);
        if (user != null) {
            activity.record("logout", user.getEmail(), user.getEmail(), "");
        }
    }

    @GetMapping("/auth/me")
    public CurrentUser me(@AuthenticationPrincipal Jwt jwt) {
        return userRepository.findById(Long.valueOf(jwt.getSubject()))
                .map(CurrentUser::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    /** A new name for the signed-in user. */
    public record NameRequest(@NotBlank(message = "Give your name.") @Size(max = 255) String name) {
    }

    /** Renames the signed-in user. */
    @PutMapping("/auth/me")
    public CurrentUser rename(@Valid @RequestBody NameRequest request, @AuthenticationPrincipal Jwt jwt) {
        User user = userRepository.findById(Long.valueOf(jwt.getSubject())).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        String name = request.name().trim();
        if (!name.equals(user.getName())) {
            activity.record("user.renamed", user.getEmail(), user.getEmail(), user.getName() + " → " + name);
            user.setName(name);
            userRepository.save(user);
        }
        return CurrentUser.of(user);
    }

    /**
     * What the browser needs before anyone logs in.
     *
     * @param contactEmail where people without access can ask for it ("" when not set)
     * @param mailEnabled  whether the app sends emails (reset links, confirmations); otherwise admins share links
     */
    public record ClientConfig(String contactEmail, boolean mailEnabled, SentrySettings sentry) {
    }

    /** Error reporting from the browser; an empty DSN turns it off. */
    public record SentrySettings(String dsn, String environment, String release) {
    }

    /** Public client configuration. */
    @GetMapping("/config")
    public ClientConfig config() {
        String contactEmail = properties.contactEmail();
        return new ClientConfig(contactEmail == null ? "" : contactEmail, emails.enabled(),
                new SentrySettings(monitoring.frontendDsn(), monitoring.environment(), monitoring.release()));
    }

    private static void requireAppRequest(String requestedWith) {
        if (requestedWith == null || requestedWith.isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Missing " + CSRF_HEADER + " header");
        }
    }
}
