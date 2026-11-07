package com.cgtcalculator.platform.settings;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** One of a user's settings: its key and its value as JSON. */
@Entity
@Table(name = "user_settings")
public class UserSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "setting_key", nullable = false, length = 60)
    private String key;

    @Column(name = "setting_value", nullable = false, length = 100_000)
    private String value;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserSetting() {
    }

    public UserSetting(Long userId, String key) {
        this.userId = userId;
        this.key = key;
    }

    void set(String value, Instant now) {
        this.value = value;
        this.updatedAt = now;
    }

    public String getKey() {
        return key;
    }

    public String getValue() {
        return value;
    }
}
