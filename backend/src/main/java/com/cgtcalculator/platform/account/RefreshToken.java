package com.cgtcalculator.platform.account;

import java.time.Instant;

import com.cgtcalculator.platform.user.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/**
 * A long-lived login, kept in an HttpOnly cookie and exchanged for short-lived access tokens. Each use replaces it
 * with a new one in the same family; presenting a replaced one again means it was copied, and ends the family.
 * Only its SHA-256 hash is stored.
 */
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** All tokens descending from one login. */
    @Column(nullable = false, length = 36)
    private String family;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    /** Revoked because it was exchanged for a new token (not by logout or a password reset). */
    @Column(name = "rotated")
    private Boolean rotated;

    protected RefreshToken() {
    }

    public RefreshToken(User user, String tokenHash, String family, Instant createdAt, Instant expiresAt) {
        this.user = user;
        this.tokenHash = tokenHash;
        this.family = family;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public User getUser() {
        return user;
    }

    public String getFamily() {
        return family;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public void revoke(Instant at) {
        if (revokedAt == null) {
            revokedAt = at;
        }
    }

    public void rotate(Instant at) {
        revoke(at);
        rotated = true;
    }

    public boolean isRotated() {
        return Boolean.TRUE.equals(rotated);
    }
}
