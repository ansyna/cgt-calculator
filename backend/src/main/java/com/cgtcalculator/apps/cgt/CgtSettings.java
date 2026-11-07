package com.cgtcalculator.apps.cgt;

import java.math.BigDecimal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A user's CGT settings. */
@Entity
@Table(name = "cgt_settings")
public class CgtSettings {

    @Id
    @Column(name = "user_id")
    private Long userId;

    /** Unused losses from years before the first sale recorded here. */
    @Column(name = "losses_before", nullable = false, precision = 20, scale = 2)
    private BigDecimal lossesBefore;

    protected CgtSettings() {
    }

    public CgtSettings(Long userId, BigDecimal lossesBefore) {
        this.userId = userId;
        this.lossesBefore = lossesBefore;
    }

    public BigDecimal getLossesBefore() {
        return lossesBefore;
    }

    public void setLossesBefore(BigDecimal lossesBefore) {
        this.lossesBefore = lossesBefore;
    }
}
