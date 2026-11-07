package com.cgtcalculator.platform.account;

import java.time.Instant;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public interface ActivityRepository extends JpaRepository<ActivityEntry, Long> {

    Page<ActivityEntry> findAllByOrderByAtDescIdDesc(Pageable pageable);

    Page<ActivityEntry> findByActionStartingWithOrderByAtDescIdDesc(String prefix, Pageable pageable);

    @Modifying
    @Transactional
    @Query("delete from ActivityEntry a where a.at < :before")
    int deleteOlderThan(Instant before);

    /** Deletes the entry and all before it (older, or as old with a lower id). */
    @Modifying
    @Transactional
    @Query("delete from ActivityEntry a where a.at < :at or (a.at = :at and a.id <= :id)")
    int deleteUpTo(Instant at, Long id);
}
