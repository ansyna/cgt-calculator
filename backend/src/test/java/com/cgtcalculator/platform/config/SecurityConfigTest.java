package com.cgtcalculator.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class SecurityConfigTest {

    private static AppProperties withSecret(String secret) {
        return new AppProperties(new AppProperties.Jwt(secret, 15), null, null, null);
    }

    @Test
    void productionRefusesToStartWithoutAJwtSecret() {
        MockEnvironment production = new MockEnvironment();
        production.setActiveProfiles("postgres");
        assertThatThrownBy(() -> new SecurityConfig().jwtSecretKey(withSecret(""), production))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("JWT_SECRET must be set");
        assertThat(new SecurityConfig().jwtSecretKey(withSecret("a".repeat(32)), production)).isNotNull();
    }

    @Test
    void elsewhereARandomSecretIsUsed() {
        assertThat(new SecurityConfig().jwtSecretKey(withSecret(null), new MockEnvironment()).getEncoded()).hasSize(32);
    }
}
