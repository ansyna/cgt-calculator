package com.cgtcalculator.platform.config;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.List;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;
import org.springframework.security.web.header.writers.StaticHeadersWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.cgtcalculator.platform.user.Role;
import com.cgtcalculator.platform.user.UserRepository;

/**
 * Stateless JWT security. Authorities are loaded from the database on every request,
 * so role/permission changes take effect immediately.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);

    /**
     * The page runs only the app's own scripts and styles (no inline ones), talks only to the app and Sentry, and
     * can't be framed. Images may come from anywhere over https (company logos).
     */
    static final String CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; "
            + "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.sentry.io; "
            + "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    /** Browser features the app never uses. */
    static final String PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
            + "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()";

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, UserRepository userRepository) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> {
                })
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/register", "/api/auth/refresh",
                                "/api/auth/logout", "/api/auth/password/forgot", "/api/auth/password/reset",
                                "/api/auth/email/verify", "/api/auth/invitation/accept").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/invitation").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/config").permitAll()
                        // the monthly backup job, with its own secret (BackupController)
                        .requestMatchers(HttpMethod.GET, "/api/backup").permitAll()
                        .requestMatchers("/api/auth/**").authenticated()
                        // Same as Laravel's role:admin group for roles/users
                        .requestMatchers("/api/users/**", "/api/roles/**", "/api/permissions/**", "/api/activity/**").hasRole(Role.ADMIN)
                        .requestMatchers("/actuator/metrics/**").hasRole(Role.ADMIN)
                        // The calculator: admins and investors
                        .requestMatchers("/api/**").hasAnyRole(Role.ADMIN, Role.INVESTOR)
                        .anyRequest().permitAll())
                .oauth2ResourceServer(oauth2 -> oauth2
                        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(source -> toAuthentication(source, userRepository))))
                .exceptionHandling(ex -> ex.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(CONTENT_SECURITY_POLICY))
                        // reset and invitation links carry their token in the address
                        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.NO_REFERRER))
                        .addHeaderWriter(new StaticHeadersWriter("Permissions-Policy", PERMISSIONS_POLICY)));
        return http.build();
    }

    private static AbstractAuthenticationToken toAuthentication(Jwt jwt, UserRepository userRepository) {
        Long userId = Long.valueOf(jwt.getSubject());
        List<SimpleGrantedAuthority> authorities = userRepository.findById(userId)
                .map(user -> user.authorityNames().map(SimpleGrantedAuthority::new).toList())
                .orElseThrow(() -> new org.springframework.security.oauth2.server.resource.InvalidBearerTokenException(
                        "Unknown user"));
        return new JwtAuthenticationToken(jwt, authorities, jwt.getSubject());
    }

    /**
     * The key that signs logins. On the production database (the postgres profile) JWT_SECRET is required: the app
     * refuses to start without it. Elsewhere (trying it out locally) a random key is used, never logged.
     */
    @Bean
    public SecretKey jwtSecretKey(AppProperties properties, Environment environment) {
        String secret = properties.jwt().secret();
        byte[] keyBytes;
        if (secret == null || secret.isBlank()) {
            if (environment.matchesProfiles("postgres")) {
                throw new IllegalStateException("JWT_SECRET must be set (at least 32 characters), e.g. the output of "
                        + "`openssl rand -base64 48`");
            }
            keyBytes = new byte[32];
            new SecureRandom().nextBytes(keyBytes);
            log.warn("JWT_SECRET is not set; using a random secret, so logins end when the app restarts");
        } else {
            keyBytes = secret.getBytes(StandardCharsets.UTF_8);
            if (keyBytes.length < 32) {
                throw new IllegalStateException("JWT_SECRET must be at least 32 bytes long");
            }
        }
        return new SecretKeySpec(keyBytes, "HmacSHA256");
    }

    @Bean
    public JwtEncoder jwtEncoder(SecretKey jwtSecretKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(jwtSecretKey));
    }

    @Bean
    public JwtDecoder jwtDecoder(SecretKey jwtSecretKey) {
        return NimbusJwtDecoder.withSecretKey(jwtSecretKey).macAlgorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt — compatible with existing Laravel ($2y$) password hashes
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(AppProperties properties) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(properties.cors().allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With"));
        // the refresh cookie when the frontend is served from another origin
        config.setAllowCredentials(true);
        config.setExposedHeaders(List.of("X-Api-Calls-Today", "X-Api-Daily-Limit", "X-Api-Limit-Reached-At"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
