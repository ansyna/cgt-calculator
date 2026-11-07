package com.cgtcalculator.platform.account;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** One line of the admin activity log. Users are kept by email, so entries survive deleting the user. */
@Entity
@Table(name = "activity_log")
public class ActivityEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Instant at;

    /** Who did it ("" for someone not logged in). */
    @Column(nullable = false)
    private String actor;

    @Column(nullable = false, length = 64)
    private String action;

    /** Whom or what it was done to. */
    @Column(nullable = false)
    private String target;

    @Column(nullable = false, length = 1000)
    private String details;

    @Column(nullable = false, length = 255)
    private String ip;

    protected ActivityEntry() {
    }

    public ActivityEntry(Instant at, String actor, String action, String target, String details, String ip) {
        this.at = at;
        this.actor = actor;
        this.action = action;
        this.target = target;
        this.details = details.length() > 1000 ? details.substring(0, 1000) : details;
        this.ip = ip;
    }

    public Long getId() {
        return id;
    }

    public Instant getAt() {
        return at;
    }

    public String getActor() {
        return actor;
    }

    public String getAction() {
        return action;
    }

    public String getTarget() {
        return target;
    }

    public String getDetails() {
        return details;
    }

    public String getIp() {
        return ip;
    }
}
