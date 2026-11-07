package com.cgtcalculator.platform.settings;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserSettingRepository extends JpaRepository<UserSetting, Long> {

    List<UserSetting> findByUserIdOrderByKeyAsc(Long userId);

    Optional<UserSetting> findByUserIdAndKey(Long userId, String key);

    long countByUserId(Long userId);
}
