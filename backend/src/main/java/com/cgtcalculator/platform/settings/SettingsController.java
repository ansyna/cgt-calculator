package com.cgtcalculator.platform.settings;

import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The signed-in user's settings, kept on their account for every device: what the calculator keeps besides the trades
 * (the theme, the tickers of a statement's companies, the CGT paid), each under a key ("theme", "cgt.tickers") as any
 * JSON.
 */
@RestController
@RequestMapping("/api/settings")
@Transactional
public class SettingsController {

    /** "cgt.form11.paid.2026", "theme" */
    static final Pattern KEY = Pattern.compile("[a-z0-9][a-z0-9._-]{0,59}");
    /** More than every app's settings take. */
    static final int MAX_SETTINGS = 200;
    /** Under a request's limit (64 KB), with room for the rest of the request. */
    static final int MAX_VALUE = 60_000;

    /** @param value any JSON: a string, a number, a list, an object */
    public record SettingRequest(@Nullable JsonNode value) {
    }

    private final UserSettingRepository settings;
    private final ObjectMapper json;
    private final Clock clock;

    public SettingsController(UserSettingRepository settings, ObjectMapper json, Clock clock) {
        this.settings = settings;
        this.json = json;
        this.clock = clock;
    }

    private static Long user(Jwt jwt) {
        return Long.valueOf(jwt.getSubject());
    }

    private static String checked(String key) {
        if (!KEY.matcher(key).matches()) throw new ValidationException("key", "A setting's key is lower-case letters, digits, dots and dashes.");
        return key;
    }

    /** Every setting of the user's, by key. */
    @GetMapping
    @Transactional(readOnly = true)
    public Map<String, JsonNode> all(@AuthenticationPrincipal Jwt jwt) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (UserSetting s : settings.findByUserIdOrderByKeyAsc(user(jwt))) out.put(s.getKey(), json.readTree(s.getValue()));
        return out;
    }

    /** Sets one; a null value takes it out. */
    @PutMapping("/{key}")
    public Map<String, JsonNode> save(@PathVariable String key, @RequestBody SettingRequest request, @AuthenticationPrincipal Jwt jwt) {
        Long userId = user(jwt);
        checked(key);
        if (request.value() == null || request.value().isNull()) {
            settings.findByUserIdAndKey(userId, key).ifPresent(settings::delete);
            return Map.of();
        }
        String value = json.writeValueAsString(request.value());
        if (value.length() > MAX_VALUE) throw new ValidationException("value", "That setting is too big to keep.");
        UserSetting setting = settings.findByUserIdAndKey(userId, key).orElseGet(() -> {
            if (settings.countByUserId(userId) >= MAX_SETTINGS) throw new ValidationException("key", "You have the most settings kept.");
            return new UserSetting(userId, key);
        });
        setting.set(value, clock.instant());
        settings.save(setting);
        return Map.of(key, request.value());
    }

    @DeleteMapping("/{key}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String key, @AuthenticationPrincipal Jwt jwt) {
        settings.findByUserIdAndKey(user(jwt), checked(key)).ifPresent(settings::delete);
    }
}
