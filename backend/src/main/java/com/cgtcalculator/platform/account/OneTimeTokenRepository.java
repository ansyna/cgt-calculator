package com.cgtcalculator.platform.account;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import com.cgtcalculator.platform.user.User;

public interface OneTimeTokenRepository extends JpaRepository<OneTimeToken, Long> {

    Optional<OneTimeToken> findByTokenHash(String tokenHash);

    List<OneTimeToken> findByUserAndPurposeAndUsedAtIsNull(User user, OneTimeToken.Purpose purpose);

    @Modifying
    @Query("delete from OneTimeToken t where t.user = :user")
    void deleteByUser(User user);
}
