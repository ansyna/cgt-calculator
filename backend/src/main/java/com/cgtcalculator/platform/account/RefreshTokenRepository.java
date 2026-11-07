package com.cgtcalculator.platform.account;

import java.time.Instant;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import com.cgtcalculator.platform.user.User;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :at where t.family = :family and t.revokedAt is null")
    int revokeFamily(String family, Instant at);

    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :at where t.user = :user and t.revokedAt is null")
    int revokeAllOf(User user, Instant at);

    @Modifying
    @Query("delete from RefreshToken t where t.user = :user")
    void deleteByUser(User user);

    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :before")
    int deleteExpiredBefore(Instant before);
}
